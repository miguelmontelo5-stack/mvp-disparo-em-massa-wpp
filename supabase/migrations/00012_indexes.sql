-- ============================================================
-- Migration 00012: Operational & High-Concurrency Partial Indexes
-- ============================================================
-- Creates indexes tailored for multi-tenant isolation,
-- high-speed skip-locked queue queries, and audit log telemetry.
-- ============================================================

-- ------------------------------------------------------------
-- Membership & RBAC Evaluation Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_org_members_user_org
  ON public.organization_members (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_org_members_org_role
  ON public.organization_members (organization_id, role);

-- ------------------------------------------------------------
-- Contacts & Audience Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contact_lists_org
  ON public.contact_lists (organization_id);

CREATE INDEX IF NOT EXISTS idx_contact_list_members_list
  ON public.contact_list_members (list_id);

CREATE INDEX IF NOT EXISTS idx_contact_list_members_contact
  ON public.contact_list_members (contact_id);

CREATE INDEX IF NOT EXISTS idx_contacts_org_name
  ON public.contacts (organization_id, name);

CREATE INDEX IF NOT EXISTS idx_suppression_phone
  ON public.suppression_list (organization_id, phone_e164);

-- ------------------------------------------------------------
-- WhatsApp Connections & Distributed Nodes Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_wa_connections_org_status
  ON public.whatsapp_connections (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_wa_connections_node_status
  ON public.whatsapp_connections (node_id, status)
  WHERE node_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_worker_nodes_status
  ON public.worker_nodes (status);

CREATE INDEX IF NOT EXISTS idx_node_heartbeats_node_created
  ON public.node_heartbeats (node_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connection_leases_expires
  ON public.connection_leases (expires_at);

-- ------------------------------------------------------------
-- Campaigns & PostgreSQL Queue Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaigns_org_status
  ON public.campaigns (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_campaigns_org_scheduled
  ON public.campaigns (organization_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_camp_recipients_camp_status
  ON public.campaign_recipients (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_camp_recipients_conn_status
  ON public.campaign_recipients (connection_id, status)
  WHERE connection_id IS NOT NULL;

-- ULTRA-CRITICAL PARTIAL INDEX for claim_campaign_recipients()
-- Accelerates queue workers polling pending batches by orders of magnitude
CREATE INDEX IF NOT EXISTS idx_camp_recipients_pending_queue
  ON public.campaign_recipients (scheduled_at ASC)
  WHERE status = 'pending';

-- Partial index for recovery of stalled workers
CREATE INDEX IF NOT EXISTS idx_camp_recipients_stale_processing
  ON public.campaign_recipients (locked_at)
  WHERE status = 'processing';

-- Message attempts index
CREATE INDEX IF NOT EXISTS idx_msg_attempts_recipient
  ON public.message_attempts (campaign_recipient_id);

-- ------------------------------------------------------------
-- Audit & Telemetry Indexes
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON public.audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conn_events_conn_created
  ON public.whatsapp_connection_events (connection_id, created_at DESC);
