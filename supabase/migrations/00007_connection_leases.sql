-- ============================================================
-- Migration 00007: Multi-Node Atomic Connection Leases
-- ============================================================
-- Creates:
--   - public.connection_leases table
--   - Single active lease per connection_id guarantee
--   - Atomic RPCs: acquire, renew, release
--   - RLS policies (write blocked from client browser)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.connection_leases (
  connection_id uuid PRIMARY KEY REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  node_id text NOT NULL REFERENCES public.worker_nodes(id) ON DELETE CASCADE,
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  acquired_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  heartbeat_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.connection_leases IS 'Distributed mutual-exclusion leases ensuring exactly one worker node operates a WhatsApp socket.';

-- Enable RLS
ALTER TABLE public.connection_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connection_leases FORCE ROW LEVEL SECURITY;

-- Read-only policy for authenticated users monitoring cluster status
CREATE POLICY "connection_leases_select_authenticated"
  ON public.connection_leases
  FOR SELECT
  TO authenticated
  USING (true);

-- Mutations are blocked for regular authenticated roles: performed via atomic RPCs or service_role

-- ------------------------------------------------------------
-- RPC: acquire_connection_lease()
-- Atomically claims a connection lease if unassigned, expired, or already owned
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.acquire_connection_lease(
  p_connection_id uuid,
  p_node_id text,
  p_ttl_seconds integer DEFAULT 45
)
RETURNS TABLE (
  acquired boolean,
  lease_token uuid,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_token uuid := gen_random_uuid();
  v_new_expires timestamptz := now() + (p_ttl_seconds || ' seconds')::interval;
  v_current_lease record;
BEGIN
  -- Validate node exists and is capable
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_nodes
    WHERE id = p_node_id AND status IN ('STARTING', 'ONLINE', 'DEGRADED')
  ) THEN
    RAISE EXCEPTION 'Worker node % is offline or does not exist', p_node_id;
  END IF;

  -- Lock row or attempt insert
  SELECT * INTO v_current_lease
  FROM public.connection_leases
  WHERE connection_id = p_connection_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No lease exists: acquire fresh lease
    INSERT INTO public.connection_leases (
      connection_id,
      node_id,
      lease_token,
      acquired_at,
      expires_at,
      heartbeat_at
    )
    VALUES (
      p_connection_id,
      p_node_id,
      v_new_token,
      now(),
      v_new_expires,
      now()
    );

    -- Update connection node binding
    UPDATE public.whatsapp_connections
    SET node_id = p_node_id
    WHERE id = p_connection_id;

    RETURN QUERY SELECT true, v_new_token, v_new_expires;
    RETURN;
  END IF;

  -- Lease exists: check if expired OR if caller is already the owner
  IF v_current_lease.expires_at < now() OR v_current_lease.node_id = p_node_id THEN
    UPDATE public.connection_leases
    SET node_id = p_node_id,
        lease_token = v_new_token,
        acquired_at = now(),
        expires_at = v_new_expires,
        heartbeat_at = now()
    WHERE connection_id = p_connection_id;

    UPDATE public.whatsapp_connections
    SET node_id = p_node_id
    WHERE id = p_connection_id;

    RETURN QUERY SELECT true, v_new_token, v_new_expires;
  ELSE
    -- Lease held by another active node
    RETURN QUERY SELECT false, v_current_lease.lease_token, v_current_lease.expires_at;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.acquire_connection_lease(uuid, text, integer) IS
  'Atomically acquires exclusive ownership of a WhatsApp connection for a worker node.';

-- ------------------------------------------------------------
-- RPC: renew_connection_lease()
-- Extends an active lease if the node_id and lease_token match
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.renew_connection_lease(
  p_connection_id uuid,
  p_node_id text,
  p_lease_token uuid,
  p_ttl_seconds integer DEFAULT 45
)
RETURNS TABLE (
  renewed boolean,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_expires timestamptz := now() + (p_ttl_seconds || ' seconds')::interval;
  v_updated integer;
BEGIN
  UPDATE public.connection_leases
  SET expires_at = v_new_expires,
      heartbeat_at = now()
  WHERE connection_id = p_connection_id
    AND node_id = p_node_id
    AND lease_token = p_lease_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    RETURN QUERY SELECT true, v_new_expires;
  ELSE
    RETURN QUERY SELECT false, NULL::timestamptz;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.renew_connection_lease(uuid, text, uuid, integer) IS
  'Atomically extends the TTL of an actively held connection lease.';

-- ------------------------------------------------------------
-- RPC: release_connection_lease()
-- Voluntarily releases a connection lease on graceful node shutdown
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_connection_lease(
  p_connection_id uuid,
  p_node_id text,
  p_lease_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.connection_leases
  WHERE connection_id = p_connection_id
    AND node_id = p_node_id
    AND lease_token = p_lease_token;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    UPDATE public.whatsapp_connections
    SET node_id = NULL
    WHERE id = p_connection_id
      AND node_id = p_node_id;
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

COMMENT ON FUNCTION public.release_connection_lease(uuid, text, uuid) IS
  'Gracefully releases a connection lease upon socket termination or node drain.';
