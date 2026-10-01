-- ============================================================
-- Migration 00006: WhatsApp Connections & Session Metadata
-- ============================================================
-- Creates:
--   - public.whatsapp_connections table
--   - public.whatsapp_connection_events table
--   - public.whatsapp_session_backups table
--   - Status check constraint (DISCONNECTED, PAIRING, CONNECTING, READY, DEGRADED, RECONNECTING, LOGGED_OUT, DISABLED, ERROR)
--   - RLS policies (Multi-tenant isolation, browser write limitations)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  node_id text REFERENCES public.worker_nodes(id) ON DELETE SET NULL,
  label text NOT NULL,
  phone_number text, -- E.164 formatted
  provider text NOT NULL DEFAULT 'baileys',
  status text NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN (
      'DISCONNECTED',
      'PAIRING',
      'CONNECTING',
      'READY',
      'DEGRADED',
      'RECONNECTING',
      'LOGGED_OUT',
      'DISABLED',
      'ERROR'
    )),
  library_version text,
  last_connected_at timestamptz,
  last_disconnected_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.whatsapp_connections IS 'WhatsApp multi-chip instances allocated to organizations.';

CREATE TRIGGER tr_whatsapp_connections_updated_at
  BEFORE UPDATE ON public.whatsapp_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- Connection Events (Lifecycle Audit)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_connection_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  previous_state text,
  new_state text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.whatsapp_connection_events IS 'Historical transition events and state changes for WhatsApp connections.';

-- ------------------------------------------------------------
-- Session Backups (Encrypted Metadata Only - No Plaintext Secrets)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_session_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.whatsapp_connections(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  encryption_version text NOT NULL DEFAULT 'v1-aes-256-gcm',
  checksum text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.whatsapp_session_backups IS 'Encrypted session backup references in Supabase Storage. Plaintext auth state is strictly forbidden.';

-- Enable RLS
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connections FORCE ROW LEVEL SECURITY;

ALTER TABLE public.whatsapp_connection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_connection_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.whatsapp_session_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_session_backups FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS Policies: whatsapp_connections
-- ------------------------------------------------------------

-- SELECT: All members of the organization can view connections
CREATE POLICY "connections_select_org_members"
  ON public.whatsapp_connections
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- INSERT: OWNER and ADMIN can provision new connection slots
CREATE POLICY "connections_insert_owner_admin"
  ON public.whatsapp_connections
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN'])
  );

-- UPDATE: OWNER and ADMIN can update connection details (label, provider, disabled status)
-- Guard against tenant hopping by ensuring organization_id cannot be changed
CREATE POLICY "connections_update_owner_admin"
  ON public.whatsapp_connections
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN'])
    AND organization_id = (SELECT c.organization_id FROM public.whatsapp_connections c WHERE c.id = public.whatsapp_connections.id)
  );

-- DELETE: OWNER and ADMIN can delete connections
CREATE POLICY "connections_delete_owner_admin"
  ON public.whatsapp_connections
  FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN']));

-- ------------------------------------------------------------
-- RLS Policies: whatsapp_connection_events
-- ------------------------------------------------------------
CREATE POLICY "conn_events_select_org_members"
  ON public.whatsapp_connection_events
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- Direct client inserts/updates to connection events are prohibited (handled by backend worker / service_role)

-- ------------------------------------------------------------
-- RLS Policies: whatsapp_session_backups
-- ------------------------------------------------------------
CREATE POLICY "session_backups_select_owner_admin"
  ON public.whatsapp_session_backups
  FOR SELECT
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN']));

-- Direct client writes prohibited (restricted to worker nodes via service_role)
