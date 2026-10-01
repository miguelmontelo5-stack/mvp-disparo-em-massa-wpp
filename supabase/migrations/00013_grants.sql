-- ============================================================
-- Migration 00013: Least Privilege Role Grants
-- ============================================================
-- Enforces strict role-based PostgreSQL grants:
--   - anon: Minimum/No access to multi-tenant operational data
--   - authenticated: Granted access to multi-tenant tables governed by RLS
--   - service_role: Backend cluster execution rights
-- ============================================================

-- Grant schema usage
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 1. Table Grants for authenticated users (Governed by RLS)
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT SELECT ON public.worker_nodes TO authenticated;
GRANT SELECT ON public.worker_nodes_public TO anon, authenticated;
GRANT SELECT ON public.node_heartbeats TO authenticated;
GRANT SELECT ON public.connection_leases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO authenticated;
GRANT SELECT ON public.whatsapp_connection_events TO authenticated;
GRANT SELECT ON public.whatsapp_session_backups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_lists TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.contact_list_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contact_consents TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.suppression_list TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_messages TO authenticated;
GRANT SELECT, INSERT ON public.campaign_recipients TO authenticated;
GRANT SELECT ON public.message_attempts TO authenticated;
GRANT SELECT, UPDATE ON public.organization_settings TO authenticated;
GRANT SELECT ON public.feature_flags TO authenticated;
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;

-- ------------------------------------------------------------
-- 2. Function & RPC Grants
-- ------------------------------------------------------------
-- RBAC Helpers & User RPCs
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_org_member_role(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_org_member(uuid, uuid) TO authenticated;

-- Internal Cluster Infrastructure & Queue RPCs:
-- Revoke from PUBLIC and authenticated to prevent unauthorized lease claims or queue manipulation by browsers.
REVOKE EXECUTE ON FUNCTION public.acquire_connection_lease(uuid, text, integer) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.renew_connection_lease(uuid, text, uuid, integer) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_connection_lease(uuid, text, uuid) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_campaign_recipients(text, integer) FROM PUBLIC, authenticated;
REVOKE EXECUTE ON FUNCTION public.requeue_stale_campaign_recipients(integer, integer) FROM PUBLIC, authenticated;

-- Grant execution of internal cluster RPCs strictly to service_role
GRANT EXECUTE ON FUNCTION public.acquire_connection_lease(uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_connection_lease(uuid, text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_connection_lease(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.requeue_stale_campaign_recipients(integer, integer) TO service_role;
