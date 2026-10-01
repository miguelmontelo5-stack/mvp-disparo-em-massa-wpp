-- ============================================================
-- Migration 00010: High-Performance PostgreSQL Job Queue
-- ============================================================
-- Implements V1 Server-Side Queue Engine using:
--   - FOR UPDATE SKIP LOCKED for high-throughput concurrency
--   - claim_campaign_recipients(): atomic job reservation with suppression check
--   - requeue_stale_campaign_recipients(): crash recovery for abandoned jobs
-- ============================================================

-- ------------------------------------------------------------
-- RPC: claim_campaign_recipients()
-- Reserves pending dispatch jobs atomically without lock contention
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(
  p_worker_id text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  recipient_id uuid,
  organization_id uuid,
  campaign_id uuid,
  contact_id uuid,
  phone_e164 text,
  contact_name text,
  message_sequence integer,
  connection_id uuid,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Auto-skip recipients whose contact phone is present in the organization's suppression list
  UPDATE public.campaign_recipients cr
  SET status = 'skipped',
      failure_code = 'SUPPRESSED_IN_SUPPRESSION_LIST',
      updated_at = now()
  FROM public.contacts c
  JOIN public.suppression_list sl
    ON sl.organization_id = c.organization_id
   AND sl.phone_e164 = c.phone_e164
  WHERE cr.contact_id = c.id
    AND cr.status = 'pending'
    AND cr.scheduled_at <= now();

  -- Claim eligible pending jobs using SKIP LOCKED
  RETURN QUERY
  WITH eligible_jobs AS (
    SELECT
      cr.id AS r_id,
      cr.organization_id AS r_org_id,
      cr.campaign_id AS r_camp_id,
      cr.contact_id AS r_contact_id,
      c.phone_e164 AS r_phone,
      c.name AS r_name,
      cr.message_sequence AS r_seq,
      cr.connection_id AS r_conn_id,
      cr.attempt_count AS r_attempt
    FROM public.campaign_recipients cr
    JOIN public.campaigns camp ON camp.id = cr.campaign_id
    JOIN public.contacts c ON c.id = cr.contact_id
    WHERE cr.status = 'pending'
      AND cr.scheduled_at <= now()
      AND camp.status IN ('RUNNING', 'QUEUED')
    ORDER BY cr.scheduled_at ASC
    LIMIT p_limit
    FOR UPDATE OF cr SKIP LOCKED
  ),
  locked_jobs AS (
    UPDATE public.campaign_recipients cr
    SET status = 'processing',
        locked_at = now(),
        locked_by = p_worker_id,
        attempt_count = cr.attempt_count + 1,
        updated_at = now()
    FROM eligible_jobs ej
    WHERE cr.id = ej.r_id
    RETURNING
      cr.id,
      cr.organization_id,
      cr.campaign_id,
      cr.contact_id,
      ej.r_phone,
      ej.r_name,
      cr.message_sequence,
      cr.connection_id,
      cr.attempt_count
  )
  SELECT
    lj.id,
    lj.organization_id,
    lj.campaign_id,
    lj.contact_id,
    lj.r_phone,
    lj.r_name,
    lj.message_sequence,
    lj.connection_id,
    lj.attempt_count
  FROM locked_jobs lj;
END;
$$;

COMMENT ON FUNCTION public.claim_campaign_recipients(text, integer) IS
  'Atomically claims pending campaign dispatches using FOR UPDATE SKIP LOCKED with suppression filter.';

-- ------------------------------------------------------------
-- RPC: requeue_stale_campaign_recipients()
-- Recovers jobs stalled by worker crashes or timeouts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.requeue_stale_campaign_recipients(
  p_stale_timeout_minutes integer DEFAULT 5,
  p_max_attempts integer DEFAULT 3
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_requeued integer := 0;
  v_failed integer := 0;
BEGIN
  -- Mark permanently failed if attempt limit exceeded
  UPDATE public.campaign_recipients
  SET status = 'failed',
      failure_code = 'EXCEEDED_MAX_ATTEMPTS_STALLED',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE status = 'processing'
    AND locked_at < now() - (p_stale_timeout_minutes || ' minutes')::interval
    AND attempt_count >= p_max_attempts;

  GET DIAGNOSTICS v_failed = ROW_COUNT;

  -- Requeue remaining stalled jobs back to pending
  UPDATE public.campaign_recipients
  SET status = 'pending',
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now()
  WHERE status = 'processing'
    AND locked_at < now() - (p_stale_timeout_minutes || ' minutes')::interval
    AND attempt_count < p_max_attempts;

  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  RETURN v_requeued;
END;
$$;

COMMENT ON FUNCTION public.requeue_stale_campaign_recipients(integer, integer) IS
  'Recovers abandoned jobs stuck in processing state back to pending or marks permanently failed.';
