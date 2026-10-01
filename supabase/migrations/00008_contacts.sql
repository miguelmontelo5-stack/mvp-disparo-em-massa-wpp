-- ============================================================
-- Migration 00008: Contacts, Lists, Consents & Suppression List
-- ============================================================
-- Creates:
--   - public.contacts
--   - public.contact_lists
--   - public.contact_list_members
--   - public.contact_consents
--   - public.suppression_list
--   - Tenant isolation & tenant hopping protection
--   - RLS policies (VIEWER read-only; OWNER/ADMIN/OPERATOR mutations)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Contacts
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone_e164 text NOT NULL, -- normalized E.164 (e.g. +5511999998888)
  email text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_contacts_org_phone UNIQUE (organization_id, phone_e164)
);

COMMENT ON TABLE public.contacts IS 'Audience contacts belonging to an organization.';

CREATE TRIGGER tr_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Contact Lists
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.contact_lists IS 'Segmented lists/tags of contacts for targeted broadcast campaigns.';

CREATE TRIGGER tr_contact_lists_updated_at
  BEFORE UPDATE ON public.contact_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Contact List Members
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_list_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES public.contact_lists(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_list_contact UNIQUE (list_id, contact_id)
);

COMMENT ON TABLE public.contact_list_members IS 'Many-to-many relationship linking contacts to contact lists.';

-- ------------------------------------------------------------
-- 4. Contact Consents (Compliance & LGPD/GDPR)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('granted', 'revoked', 'unknown')),
  source text,
  proof text,
  captured_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.contact_consents IS 'Consent tracking and opt-in/opt-out status for compliance.';

-- ------------------------------------------------------------
-- 5. Suppression List
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.suppression_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  phone_e164 text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('opt_out', 'manual_block', 'invalid_number', 'complaint', 'legal')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_suppression_org_phone UNIQUE (organization_id, phone_e164)
);

COMMENT ON TABLE public.suppression_list IS 'Global/Org blacklist suppressing automated dispatches to blocked recipients.';

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_lists FORCE ROW LEVEL SECURITY;

ALTER TABLE public.contact_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_list_members FORCE ROW LEVEL SECURITY;

ALTER TABLE public.contact_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_consents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.suppression_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppression_list FORCE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- RLS: contacts
-- ------------------------------------------------------------
CREATE POLICY "contacts_select_members"
  ON public.contacts
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "contacts_insert_mutation_roles"
  ON public.contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "contacts_update_mutation_roles"
  ON public.contacts
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR'])
    -- Prevent tenant hopping: cannot reassign contact to another organization
    AND organization_id = (SELECT c.organization_id FROM public.contacts c WHERE c.id = public.contacts.id)
  );

CREATE POLICY "contacts_delete_mutation_roles"
  ON public.contacts
  FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- ------------------------------------------------------------
-- RLS: contact_lists
-- ------------------------------------------------------------
CREATE POLICY "contact_lists_select_members"
  ON public.contact_lists
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "contact_lists_insert_mutation_roles"
  ON public.contact_lists
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "contact_lists_update_mutation_roles"
  ON public.contact_lists
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR'])
    AND organization_id = (SELECT l.organization_id FROM public.contact_lists l WHERE l.id = public.contact_lists.id)
  );

CREATE POLICY "contact_lists_delete_mutation_roles"
  ON public.contact_lists
  FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- ------------------------------------------------------------
-- RLS: contact_list_members
-- ------------------------------------------------------------
CREATE POLICY "list_members_select_members"
  ON public.contact_list_members
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "list_members_insert_mutation_roles"
  ON public.contact_list_members
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "list_members_delete_mutation_roles"
  ON public.contact_list_members
  FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

-- ------------------------------------------------------------
-- RLS: contact_consents
-- ------------------------------------------------------------
CREATE POLICY "consents_select_members"
  ON public.contact_consents
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "consents_insert_mutation_roles"
  ON public.contact_consents
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "consents_update_mutation_roles"
  ON public.contact_consents
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']))
  WITH CHECK (
    public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR'])
    AND organization_id = (SELECT cs.organization_id FROM public.contact_consents cs WHERE cs.id = public.contact_consents.id)
  );

-- ------------------------------------------------------------
-- RLS: suppression_list
-- ------------------------------------------------------------
CREATE POLICY "suppression_select_members"
  ON public.suppression_list
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "suppression_insert_mutation_roles"
  ON public.suppression_list
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN', 'OPERATOR']));

CREATE POLICY "suppression_delete_owner_admin"
  ON public.suppression_list
  FOR DELETE
  TO authenticated
  USING (public.has_org_role(organization_id, ARRAY['OWNER', 'ADMIN']));
