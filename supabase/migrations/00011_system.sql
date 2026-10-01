-- ============================================================
-- Migration 00011: Settings, Feature Flags, Append-Only Audit & Org Onboarding
-- ============================================================
-- Creates:
--   - public.organization_settings
--   - public.feature_flags (global or org-scoped)
--   - public.audit_logs (append-only)
--   - RPC create_organization() (atomic multi-tenant onboarding)
--   - Row Level Security (RLS) policies
-- ============================================================

-- ------------------------------------------------------------
-- 1. Organization Settings
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.organization_settings IS 'Tenant operational parameters, webhook configs and dispatch throttle settings.';

CREATE TRIGGER tr_organization_settings_updated_at
  BEFORE UPDATE ON public.organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Feature Flags
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE, -- NULL = platform-wide flag
  key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_feature_flag_org_key UNIQUE NULLS NOT DISTINCT (organization_id, key)
);

COMMENT ON TABLE public.feature_flags IS 'Runtime toggles and configuration overrides, globally or tenant-scoped.';

CREATE TRIGGER tr_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Audit Logs (Append-Only)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  ip inet,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.audit_logs IS 'Immutable compliance audit trail tracking security-critical mutations.';

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS: organization_settings
-- ------------------------------------------------------------
CREATE POLICY "settings_select_members"
  ON public.organization_settings
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "settings_update_owner_admin"
  ON public.organization_settings
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN'])
    AND organization_id = (SELECT s.organization_id FROM public.organization_settings s WHERE s.id = public.organization_settings.id)
  );

-- ------------------------------------------------------------
-- RLS: feature_flags
-- ------------------------------------------------------------
CREATE POLICY "feature_flags_select_authenticated"
  ON public.feature_flags
  FOR SELECT
  TO authenticated
  USING (
    organization_id IS NULL -- Global flag
    OR public.is_org_member(organization_id) -- Tenant-specific flag
  );

-- Mutations to feature flags are managed by platform superadmins / service_role

-- ------------------------------------------------------------
-- RLS: audit_logs (Strict Append-Only)
-- ------------------------------------------------------------
-- SELECT: Only OWNER and ADMIN can inspect security audit trails
CREATE POLICY "audit_logs_select_owner_admin"
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN']));

-- INSERT: Allowed for members recording authorized events
CREATE POLICY "audit_logs_insert_members"
  ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- UPDATE and DELETE: STRICTLY PROHIBITED for authenticated users (append-only)
-- No policies defined for UPDATE/DELETE -> automatically DENIED by RLS.

-- ------------------------------------------------------------
-- RPC: create_organization()
-- Transactional onboarding function: ensures every organization has an OWNER
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name text,
  p_slug text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
  v_clean_slug text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name cannot be empty';
  END IF;

  v_clean_slug := lower(trim(p_slug));
  IF v_clean_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'Slug must contain only alphanumeric lowercase characters and dashes';
  END IF;

  -- 1. Create Organization
  INSERT INTO public.organizations (name, slug, owner_id, status)
  VALUES (trim(p_name), v_clean_slug, v_user_id, 'active')
  RETURNING id INTO v_org_id;

  -- 2. Add creator as OWNER
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (v_org_id, v_user_id, 'OWNER');

  -- 3. Initialize Settings
  INSERT INTO public.organization_settings (organization_id, settings)
  VALUES (v_org_id, '{"dispatch_rate_limit_per_minute": 60, "timezone": "America/Sao_Paulo"}'::jsonb);

  -- 4. Record Audit Log
  INSERT INTO public.audit_logs (organization_id, user_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_org_id,
    v_user_id,
    'ORGANIZATION_CREATED',
    'organization',
    v_org_id::text,
    jsonb_build_object('name', p_name, 'slug', v_clean_slug)
  );

  RETURN v_org_id;
END;
$$;

COMMENT ON FUNCTION public.create_organization(text, text) IS
  'Transactionally creates organization, provisions creator as OWNER, initializes settings and audits.';
