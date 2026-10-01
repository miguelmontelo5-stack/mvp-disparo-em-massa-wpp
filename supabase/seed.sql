-- ============================================================
-- Seed File: Development & Testing Demonstration Data
-- ============================================================
-- Contains:
--   - Test worker nodes (OCI & GCP clusters)
--   - Global feature flags
--   - Idempotent test datasets without real personal data or credentials
-- ============================================================

-- 1. Demo Worker Nodes
INSERT INTO public.worker_nodes (id, name, provider, region, status, max_connections, active_connections, version)
VALUES
  ('node-oci-01', 'Oracle Node Primary', 'oracle', 'sa-saopaulo-1', 'ONLINE', 25, 0, '2.0.0'),
  ('node-gcp-01', 'Google Node Secondary', 'gcp', 'southamerica-east1', 'ONLINE', 15, 0, '2.0.0')
ON CONFLICT (id) DO UPDATE SET
  status = EXCLUDED.status,
  updated_at = now();

-- 2. Global Feature Flags
INSERT INTO public.feature_flags (key, enabled, config)
VALUES
  ('enable_pg_queue_v1', true, '{"batch_size": 20, "poll_interval_ms": 1000}'::jsonb),
  ('enable_multi_chip_round_robin', true, '{"max_chips_per_org": 10}'::jsonb),
  ('enable_realtime_websocket', true, '{"heartbeat_interval_s": 25}'::jsonb)
ON CONFLICT (organization_id, key) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  config = EXCLUDED.config,
  updated_at = now();
