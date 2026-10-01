-- ============================================================
-- Migration 00004: Organization Members, RBAC Helpers & Policies
-- ============================================================
-- Creates:
--   - public.organization_members table
--   - Role check constraint ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER')
--   - Unique constraint (organization_id, user_id)
--   - Central RBAC Helpers: is_org_member, get_org_role, has_org_role, is_org_owner (SECURITY DEFINER)
--   - Extended profile policy for co-members
--   - RLS activation & policies for organizations
--   - RLS activation & policies for organization_members
--   - Trigger: check_owner_invariants (prevent zero owners)
--   - Secure membership RPCs
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER')),
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_organization_member UNIQUE (organization_id, user_id)
);

COMMENT ON TABLE public.organization_members IS 'Stores tenant membership and RBAC role assignments.';

-- ============================================================
-- Central RBAC Helper Functions (SECURITY DEFINER with safe search_path)
-- These functions use auth.uid() internally to resolve the caller's context
-- without triggering recursive RLS loops on organization_members.
-- ============================================================

-- is_org_member(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.is_org_member(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.is_org_member(uuid) IS
  'SECURITY DEFINER helper: returns true if auth.uid() is a member of the given organization. Safe search_path prevents search_path injection.';

-- get_org_role(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.get_org_role(p_organization_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = auth.uid()
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_org_role(uuid) IS
  'SECURITY DEFINER helper: returns role of auth.uid() in the given organization, or NULL if not a member.';

-- has_org_role(p_organization_id uuid, p_roles text[])
CREATE OR REPLACE FUNCTION public.has_org_role(p_organization_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
      AND role = ANY(p_roles)
  );
$$;

COMMENT ON FUNCTION public.has_org_role(uuid, text[]) IS
  'SECURITY DEFINER helper: returns true if auth.uid() has one of the specified roles in the given organization.';

-- is_org_owner(p_organization_id uuid)
CREATE OR REPLACE FUNCTION public.is_org_owner(p_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_organization_id
      AND user_id = auth.uid()
      AND role = 'OWNER'
  );
$$;

COMMENT ON FUNCTION public.is_org_owner(uuid) IS
  'SECURITY DEFINER helper: returns true if auth.uid() is OWNER of the given organization.';

-- ------------------------------------------------------------
-- Extended Profile Policy: allow co-members of same org to read profile
-- ------------------------------------------------------------
CREATE POLICY "profiles_select_co_members"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members my_m
      JOIN public.organization_members other_m
        ON my_m.organization_id = other_m.organization_id
      WHERE my_m.user_id = auth.uid()
        AND other_m.user_id = public.profiles.id
    )
  );

-- ============================================================
-- Row Level Security: public.organizations
-- ============================================================
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations FORCE ROW LEVEL SECURITY;

CREATE POLICY "organizations_select_members"
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(id));

CREATE POLICY "organizations_update_owner_admin"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(id, ARRAY['OWNER', 'ADMIN']))
  WITH CHECK (
    public.has_org_role(id, ARRAY['OWNER', 'ADMIN'])
    AND (
      owner_id = (SELECT o.owner_id FROM public.organizations o WHERE o.id = public.organizations.id)
      OR public.is_org_owner(id)
    )
  );

-- ============================================================
-- Row Level Security: public.organization_members
-- ============================================================
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members FORCE ROW LEVEL SECURITY;

-- SELECT: Users can always see their own memberships, or co-members in an org they belong to
CREATE POLICY "members_select_same_org"
  ON public.organization_members
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_org_member(organization_id)
  );

CREATE POLICY "members_insert_owner_admin"
  ON public.organization_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.is_org_owner(organization_id)
      OR (
        public.has_org_role(organization_id, ARRAY['ADMIN'])
        AND role IN ('OPERATOR', 'VIEWER')
      )
    )
    AND user_id <> auth.uid()
  );

CREATE POLICY "members_update_owner_admin"
  ON public.organization_members
  FOR UPDATE
  TO authenticated
  USING (
    public.is_org_owner(organization_id)
    OR (
      public.has_org_role(organization_id, ARRAY['ADMIN'])
      AND role IN ('OPERATOR', 'VIEWER')
    )
  )
  WITH CHECK (
    public.is_org_owner(organization_id)
    OR (
      public.has_org_role(organization_id, ARRAY['ADMIN'])
      AND role IN ('OPERATOR', 'VIEWER')
    )
  );

CREATE POLICY "members_delete_owner_admin"
  ON public.organization_members
  FOR DELETE
  TO authenticated
  USING (
    public.is_org_owner(organization_id)
    OR (
      public.has_org_role(organization_id, ARRAY['ADMIN'])
      AND role IN ('OPERATOR', 'VIEWER')
    )
  );

-- ------------------------------------------------------------
-- Integrity Trigger: Ensure at least one OWNER per organization
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_owner_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid;
  v_remaining_owners integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_org_id := OLD.organization_id;
    IF OLD.role = 'OWNER' THEN
      SELECT count(*) INTO v_remaining_owners
      FROM public.organization_members
      WHERE organization_id = v_org_id
        AND role = 'OWNER'
        AND id <> OLD.id;

      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'Operation denied: Organization % must retain at least one OWNER.', v_org_id;
      END IF;
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    v_org_id := NEW.organization_id;
    IF OLD.role = 'OWNER' AND NEW.role <> 'OWNER' THEN
      SELECT count(*) INTO v_remaining_owners
      FROM public.organization_members
      WHERE organization_id = v_org_id
        AND role = 'OWNER'
        AND id <> OLD.id;

      IF v_remaining_owners = 0 THEN
        RAISE EXCEPTION 'Operation denied: Organization % must retain at least one OWNER.', v_org_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_check_owner_invariants
  BEFORE UPDATE OR DELETE ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.check_owner_invariants();

-- ------------------------------------------------------------
-- SECURE MEMBERSHIP RPCs
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_org_member_role(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_new_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role text;
  v_target_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_new_role NOT IN ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER') THEN
    RAISE EXCEPTION 'Invalid role specified: %', p_new_role;
  END IF;

  SELECT role INTO v_caller_role
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Access denied: caller is not a member of organization %', p_organization_id;
  END IF;

  SELECT role INTO v_target_role
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = p_target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member of organization %', p_organization_id;
  END IF;

  IF v_caller_role NOT IN ('OWNER', 'ADMIN') THEN
    RAISE EXCEPTION 'Insufficient permissions to alter membership roles';
  END IF;

  IF v_caller_role = 'ADMIN' AND (v_target_role = 'OWNER' OR p_new_role = 'OWNER') THEN
    RAISE EXCEPTION 'Admins cannot modify or assign OWNER role';
  END IF;

  IF auth.uid() = p_target_user_id AND v_caller_role = 'OWNER' AND p_new_role <> 'OWNER' THEN
    IF (SELECT count(*) FROM public.organization_members WHERE organization_id = p_organization_id AND role = 'OWNER') <= 1 THEN
      RAISE EXCEPTION 'Cannot demote the sole OWNER of an organization';
    END IF;
  END IF;

  UPDATE public.organization_members
  SET role = p_new_role
  WHERE organization_id = p_organization_id
    AND user_id = p_target_user_id;
END;
$$;

COMMENT ON FUNCTION public.change_org_member_role(uuid, uuid, text) IS
  'Securely changes member role enforcing privilege escalation rules.';

CREATE OR REPLACE FUNCTION public.remove_org_member(
  p_organization_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role text;
  v_target_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role INTO v_caller_role
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = auth.uid();

  IF v_caller_role IS NULL THEN
    RAISE EXCEPTION 'Caller is not a member of organization %', p_organization_id;
  END IF;

  SELECT role INTO v_target_role
  FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = p_target_user_id;

  IF v_target_role IS NULL THEN
    RAISE EXCEPTION 'Target user is not a member';
  END IF;

  IF auth.uid() = p_target_user_id THEN
    IF v_caller_role = 'OWNER' THEN
      IF (SELECT count(*) FROM public.organization_members WHERE organization_id = p_organization_id AND role = 'OWNER') <= 1 THEN
        RAISE EXCEPTION 'The sole OWNER cannot leave the organization without transferring ownership';
      END IF;
    END IF;
  ELSE
    IF v_caller_role = 'ADMIN' AND v_target_role IN ('OWNER', 'ADMIN') THEN
      RAISE EXCEPTION 'Admins cannot remove Owners or other Admins';
    ELSIF v_caller_role NOT IN ('OWNER', 'ADMIN') THEN
      RAISE EXCEPTION 'Insufficient permissions to remove members';
    END IF;
  END IF;

  DELETE FROM public.organization_members
  WHERE organization_id = p_organization_id
    AND user_id = p_target_user_id;
END;
$$;

COMMENT ON FUNCTION public.remove_org_member(uuid, uuid) IS
  'Securely removes a member from an organization, respecting OWNER/ADMIN constraints.';
