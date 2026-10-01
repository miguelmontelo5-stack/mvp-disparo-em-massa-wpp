-- ============================================================
-- Migration 00005: Multi-Node Infrastructure & Heartbeats
-- ============================================================
-- Creates:
--   - public.worker_nodes table
--   - public.node_heartbeats table
--   - Status check constraint ('STARTING', 'ONLINE', 'DEGRADED', 'DRAINING', 'OFFLINE', 'MAINTENANCE')
--   - Sanitized public view: worker_nodes_public
--   - RLS policies (Strict: writes restricted to service_role)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.worker_nodes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  provider text NOT NULL, -- e.g. 'oracle', 'gcp', 'vps'
  region text NOT NULL,
  status text NOT NULL DEFAULT 'STARTING'
    CHECK (status IN ('STARTING', 'ONLINE', 'DEGRADED', 'DRAINING', 'OFFLINE', 'MAINTENANCE')),
  max_connections integer NOT NULL DEFAULT 10,
  active_connections integer NOT NULL DEFAULT 0,
  version text,
  deployment_sha text,
  last_heartbeat_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.worker_nodes IS 'Physical/Cloud worker instances executing WhatsApp Baileys sessions.';

CREATE TRIGGER tr_worker_nodes_updated_at
  BEFORE UPDATE ON public.worker_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.node_heartbeats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id text NOT NULL REFERENCES public.worker_nodes(id) ON DELETE CASCADE,
  memory_usage jsonb,
  cpu_usage numeric,
  active_connections integer NOT NULL DEFAULT 0,
  uptime_seconds bigint DEFAULT 0,
  worker_version text,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.node_heartbeats IS 'Time-series health metrics ingested from worker nodes.';

-- Enable RLS on both tables
ALTER TABLE public.worker_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_nodes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.node_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.node_heartbeats FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS Policies
-- Direct mutations by browsers are prohibited.
-- Writing is strictly reserved for trusted backend (service_role).
-- ------------------------------------------------------------

-- SELECT on worker_nodes: authenticated users can monitor cluster capacity
CREATE POLICY "worker_nodes_read_authenticated"
  ON public.worker_nodes
  FOR SELECT
  TO authenticated
  USING (true);

-- node_heartbeats: internal operational data, read-only for authenticated users
CREATE POLICY "node_heartbeats_read_authenticated"
  ON public.node_heartbeats
  FOR SELECT
  TO authenticated
  USING (true);

-- ------------------------------------------------------------
-- Sanitized View: worker_nodes_public
-- Exposes operational metrics to the UI without sensitive internals
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.worker_nodes_public AS
SELECT
  id,
  name,
  provider,
  region,
  status,
  active_connections,
  max_connections,
  last_heartbeat_at
FROM public.worker_nodes;

COMMENT ON VIEW public.worker_nodes_public IS 'Sanitized public view of active cluster worker nodes.';
