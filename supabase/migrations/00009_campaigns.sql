-- ============================================================
-- Migration 00009: Campaigns, Messages, Recipients & Attempts
-- ============================================================
-- Creates:
--   - public.campaigns
--   - public.campaign_messages
--   - public.campaign_recipients (with idempotency constraints)
--   - public.message_attempts (execution logs)
--   - Row Level Security (RLS) policies
-- ============================================================

-- ------------------------------------------------------------
-- 1. Campaigns
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SCHEDULED', 'QUEUED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED')),
  connection_strategy text NOT NULL DEFAULT 'SINGLE_CONNECTION'
    CHECK (connection_strategy IN ('SINGLE_CONNECTION', 'ROUND_ROBIN', 'LEAST_BUSY', 'MANUAL_POOL')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.campaigns IS 'High-level broadcast campaigns configured by organization operators.';

CREATE TRIGGER tr_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Campaign Messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 1,
  type text NOT NULL DEFAULT 'text'
    CHECK (type IN ('text', 'image', 'video', 'document', 'audio')),
  body text,
  media_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_campaign_message_seq UNIQUE (campaign_id, sequence)
);

COMMENT ON TABLE public.campaign_messages IS 'Ordered message sequence to be sent to campaign recipients.';

-- ------------------------------------------------------------
-- 3. Campaign Recipients (PostgreSQL Queue Backlog)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.whatsapp_connections(id) ON DELETE SET NULL,
  message_sequence integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed', 'skipped')),
  scheduled_at timestamptz DEFAULT now() NOT NULL,
  locked_at timestamptz,
  locked_by text,
  attempt_count integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  failure_code text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  -- Core Idempotency Guarantee: Prevents duplicate dispatches per contact/sequence
  CONSTRAINT uq_campaign_recipient_idempotency UNIQUE (campaign_id, contact_id, message_sequence)
);

COMMENT ON TABLE public.campaign_recipients IS 'Individual dispatch jobs queued for delivery. Acts as queue item in PostgreSQL V1.';

CREATE TRIGGER tr_campaign_recipients_updated_at
  BEFORE UPDATE ON public.campaign_recipients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 4. Message Attempts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.message_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  campaign_recipient_id uuid NOT NULL REFERENCES public.campaign_recipients(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.whatsapp_connections(id) ON DELETE SET NULL,
  node_id text REFERENCES public.worker_nodes(id) ON DELETE SET NULL,
  attempt integer NOT NULL DEFAULT 1,
  started_at timestamptz DEFAULT now() NOT NULL,
  finished_at timestamptz,
  result text NOT NULL CHECK (result IN ('success', 'failed')),
  error_type text CHECK (error_type IN ('TRANSIENT', 'PERMANENT', 'AUTH', 'POLICY', 'INTERNAL')),
  error_code text,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.message_attempts IS 'Audit trial of individual socket send attempts with telemetry and error classification.';

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns FORCE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_messages FORCE ROW LEVEL SECURITY;

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients FORCE ROW LEVEL SECURITY;

ALTER TABLE public.message_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attempts FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS: campaigns
-- ------------------------------------------------------------
CREATE POLICY "campaigns_select_members"
  ON public.campaigns
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "campaigns_insert_mutation_roles"
  ON public.campaigns
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "campaigns_update_mutation_roles"
  ON public.campaigns
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR'])
    -- Prevent tenant hopping
    AND organization_id = (SELECT c.organization_id FROM public.campaigns c WHERE c.id = public.campaigns.id)
  );

CREATE POLICY "campaigns_delete_mutation_roles"
  ON public.campaigns
  FOR DELETE
  TO authenticated
  USING (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR'])
    -- Only allow deleting drafts or cancelled campaigns to preserve history
    AND status IN ('DRAFT', 'CANCELLED')
  );

-- ------------------------------------------------------------
-- RLS: campaign_messages
-- ------------------------------------------------------------
CREATE POLICY "camp_messages_select_members"
  ON public.campaign_messages
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "camp_messages_insert_mutation_roles"
  ON public.campaign_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "camp_messages_update_mutation_roles"
  ON public.campaign_messages
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR'])
    AND organization_id = (SELECT m.organization_id FROM public.campaign_messages m WHERE m.id = public.campaign_messages.id)
  );

CREATE POLICY "camp_messages_delete_mutation_roles"
  ON public.campaign_messages
  FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- ------------------------------------------------------------
-- RLS: campaign_recipients
-- ------------------------------------------------------------
CREATE POLICY "recipients_select_members"
  ON public.campaign_recipients
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Recipient insertion is allowed during campaign setup
CREATE POLICY "recipients_insert_mutation_roles"
  ON public.campaign_recipients
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- Direct client updates/deletes to operational status are prohibited to prevent status spoofing;
-- Execution updates are strictly handled by worker nodes via queue RPCs / service_role.

-- ------------------------------------------------------------
-- RLS: message_attempts
-- ------------------------------------------------------------
CREATE POLICY "attempts_select_members"
  ON public.message_attempts
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Direct writes strictly reserved for backend / service_role
