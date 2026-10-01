-- ============================================================
-- Migration 00003: Organizations
-- ============================================================
-- Creates:
--   - public.organizations table
--   - Status check constraint ('active', 'suspended', 'archived')
--   - updated_at trigger
-- Note: RLS enablement and policies are applied in Migration 00004
--       immediately after organization_members and RBAC helpers are defined.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.organizations IS 'Tenants/Organizations in the multi-tenant DLM SaaS platform.';
COMMENT ON COLUMN public.organizations.slug IS 'Unique URL-friendly slug for the organization';
COMMENT ON COLUMN public.organizations.owner_id IS 'Current owner user ID. Must reference auth.users.';

-- Trigger updated_at
CREATE TRIGGER tr_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
