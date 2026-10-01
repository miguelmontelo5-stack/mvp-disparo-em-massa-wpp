-- ============================================================
-- SQL Test Suite: RLS, Cross-Tenant Isolation & RBAC Validation
-- ============================================================
-- Executes assertions under the 'authenticated' role to strictly
-- validate that PostgreSQL Row Level Security enforces all tenant
-- isolation boundaries and RBAC matrix rules.
-- ============================================================

\set ON_ERROR_STOP on

-- ------------------------------------------------------------
-- 1. SETUP FIXTURE DATA (Run as superuser/service_role)
-- ------------------------------------------------------------
RESET ROLE;

DO $$
BEGIN
  -- Insert test users into auth schema
  INSERT INTO auth.users (id, email)
  VALUES
    ('11111111-1111-1111-1111-111111111111'::uuid, 'user_a@test.com'),
    ('22222222-2222-2222-2222-222222222222'::uuid, 'user_b@test.com'),
    ('33333333-3333-3333-3333-333333333333'::uuid, 'user_c@test.com'),
    ('44444444-4444-4444-4444-444444444444'::uuid, 'user_d@test.com'),
    ('55555555-5555-5555-5555-555555555555'::uuid, 'user_e@test.com')
  ON CONFLICT (id) DO NOTHING;

  -- Create Organizations
  INSERT INTO public.organizations (id, name, slug, owner_id)
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Organization Alpha', 'org-alpha', '11111111-1111-1111-1111-111111111111'::uuid),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Organization Beta', 'org-beta', '22222222-2222-2222-2222-222222222222'::uuid)
  ON CONFLICT (id) DO NOTHING;

  -- Assign Memberships
  -- User A: OWNER Org 1
  -- User B: OWNER Org 2
  -- User C: VIEWER Org 1
  -- User D: OPERATOR Org 1
  -- User E: No membership
  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '11111111-1111-1111-1111-111111111111'::uuid, 'OWNER'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, 'OWNER'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '33333333-3333-3333-3333-333333333333'::uuid, 'VIEWER'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 'OPERATOR')
  ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

  -- Contacts
  INSERT INTO public.contacts (id, organization_id, name, phone_e164)
  VALUES
    ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Client Alpha 1', '+5511999990001'),
    ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Client Beta 1', '+5511999990002')
  ON CONFLICT (id) DO NOTHING;

  -- Campaign
  INSERT INTO public.campaigns (id, organization_id, name, status)
  VALUES ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Alpha Campaign 1', 'DRAFT')
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ------------------------------------------------------------
-- TEST 1: User A (OWNER Org Alpha) Isolation
-- ------------------------------------------------------------
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', false);

DO $$
DECLARE
  v_count integer;
BEGIN
  -- Can read Org Alpha
  SELECT count(*) INTO v_count FROM public.organizations WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  ASSERT v_count = 1, 'TEST 1.1 FAILED: User A cannot read Org Alpha';

  -- Cannot read Org Beta
  SELECT count(*) INTO v_count FROM public.organizations WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  ASSERT v_count = 0, 'TEST 1.2 FAILED: User A must not read Org Beta';

  -- Can read Org Alpha contacts
  SELECT count(*) INTO v_count FROM public.contacts WHERE id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid;
  ASSERT v_count = 1, 'TEST 1.3 FAILED: User A cannot read Org Alpha contacts';

  -- Cannot read Org Beta contacts
  SELECT count(*) INTO v_count FROM public.contacts WHERE id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'::uuid;
  ASSERT v_count = 0, 'TEST 1.4 FAILED: User A must not read Org Beta contacts';

  RAISE NOTICE '>>> TEST 1 PASS: User A isolation verified.';
END $$;

-- ------------------------------------------------------------
-- TEST 2: User B (OWNER Org Beta) Isolation
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}', false);

DO $$
DECLARE
  v_count integer;
BEGIN
  -- Can read Org Beta
  SELECT count(*) INTO v_count FROM public.organizations WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  ASSERT v_count = 1, 'TEST 2.1 FAILED: User B cannot read Org Beta';

  -- Cannot read Org Alpha
  SELECT count(*) INTO v_count FROM public.organizations WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  ASSERT v_count = 0, 'TEST 2.2 FAILED: User B must not read Org Alpha';

  -- Cannot read Org Alpha contacts
  SELECT count(*) INTO v_count FROM public.contacts WHERE id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid;
  ASSERT v_count = 0, 'TEST 2.3 FAILED: User B must not read Org Alpha contacts';

  RAISE NOTICE '>>> TEST 2 PASS: User B isolation verified.';
END $$;

-- ------------------------------------------------------------
-- TEST 3: User C (VIEWER Org Alpha) — Read-Only Enforcement
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}', false);

DO $$
DECLARE
  v_count integer;
  v_blocked boolean := false;
BEGIN
  -- VIEWER can read Org Alpha contacts
  SELECT count(*) INTO v_count FROM public.contacts WHERE organization_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  ASSERT v_count >= 1, 'TEST 3.1 FAILED: VIEWER should read Org Alpha contacts';

  -- VIEWER blocked from inserting contacts
  BEGIN
    INSERT INTO public.contacts (organization_id, name, phone_e164)
    VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Illegal Contact', '+5511999990099');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  ASSERT v_blocked = true, 'TEST 3.2 FAILED: VIEWER was not blocked from inserting contact';

  -- VIEWER blocked from mutating campaigns
  v_blocked := false;
  BEGIN
    UPDATE public.campaigns
    SET name = 'Tampered by Viewer'
    WHERE id = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  -- If update returns 0 rows due to RLS check, verify name did not change
  IF NOT v_blocked THEN
    SELECT count(*) INTO v_count FROM public.campaigns WHERE id = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid AND name = 'Tampered by Viewer';
    ASSERT v_count = 0, 'TEST 3.3 FAILED: VIEWER tampered campaign name';
  END IF;

  RAISE NOTICE '>>> TEST 3 PASS: VIEWER read-only enforcement verified.';
END $$;

-- ------------------------------------------------------------
-- TEST 4: User D (OPERATOR Org Alpha) — Allowed Operations vs RBAC
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "44444444-4444-4444-4444-444444444444", "role": "authenticated"}', false);

DO $$
DECLARE
  v_count integer;
  v_blocked boolean := false;
BEGIN
  -- OPERATOR can insert contacts in Org Alpha
  INSERT INTO public.contacts (organization_id, name, phone_e164)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Operator Added Contact', '+5511999990077');

  SELECT count(*) INTO v_count FROM public.contacts WHERE phone_e164 = '+5511999990077';
  ASSERT v_count = 1, 'TEST 4.1 FAILED: OPERATOR could not insert contact';

  -- OPERATOR CANNOT alter member roles
  BEGIN
    PERFORM public.change_org_member_role('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '44444444-4444-4444-4444-444444444444'::uuid, 'OWNER');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  ASSERT v_blocked = true, 'TEST 4.2 FAILED: OPERATOR must not change roles';

  RAISE NOTICE '>>> TEST 4 PASS: OPERATOR role privileges and boundaries verified.';
END $$;

-- ------------------------------------------------------------
-- TEST 5: Tenant Hopping Attack Prevention
-- User A attempts to move an Org Alpha contact to Org Beta
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', false);

DO $$
DECLARE
  v_blocked boolean := false;
  v_count integer;
BEGIN
  BEGIN
    UPDATE public.contacts
    SET organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid
    WHERE id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;

  -- Ensure row did not migrate to Org Beta
  SELECT count(*) INTO v_count
  FROM public.contacts
  WHERE id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid
    AND organization_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
  ASSERT v_count = 0, 'TEST 5 FAILED: Contact migrated across tenants! Tenant hopping succeeded.';

  RAISE NOTICE '>>> TEST 5 PASS: Tenant hopping prevented.';
END $$;

-- ------------------------------------------------------------
-- TEST 6: Forged organization_id on INSERT
-- User A attempts to inject a contact directly into Org Beta
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}', false);

DO $$
DECLARE
  v_blocked boolean := false;
  v_count integer;
BEGIN
  BEGIN
    INSERT INTO public.contacts (organization_id, name, phone_e164)
    VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 'Injected Contact', '+5511999990099');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;

  SELECT count(*) INTO v_count
  FROM public.contacts
  WHERE phone_e164 = '+5511999990099';
  ASSERT v_count = 0, 'TEST 6 FAILED: Forged contact injection succeeded in Org Beta!';

  RAISE NOTICE '>>> TEST 6 PASS: Forged organization_id insertion blocked.';
END $$;

-- ------------------------------------------------------------
-- TEST 7: Outsider / Anonymous Isolation
-- User E has no memberships anywhere
-- ------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}', false);

DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.organizations;
  ASSERT v_count = 0, 'TEST 7.1 FAILED: Outsider saw organizations';

  SELECT count(*) INTO v_count FROM public.contacts;
  ASSERT v_count = 0, 'TEST 7.2 FAILED: Outsider saw contacts';

  SELECT count(*) INTO v_count FROM public.campaigns;
  ASSERT v_count = 0, 'TEST 7.3 FAILED: Outsider saw campaigns';

  RAISE NOTICE '>>> TEST 7 PASS: Outsider user denied all tenant access.';
END $$;

-- ------------------------------------------------------------
-- TEST 8: PostgreSQL Queue Claim & Suppression Logic
-- ------------------------------------------------------------
RESET ROLE;

DO $$
DECLARE
  v_recipient_normal_id uuid := gen_random_uuid();
  v_recipient_suppressed_id uuid := gen_random_uuid();
  v_contact_suppressed_id uuid := gen_random_uuid();
  v_claimed record;
  v_claim_count integer := 0;
  v_skipped_status text;
BEGIN
  -- Mark campaign as RUNNING
  UPDATE public.campaigns
  SET status = 'RUNNING'
  WHERE id = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid;

  -- Create suppressed contact
  INSERT INTO public.contacts (id, organization_id, name, phone_e164)
  VALUES (v_contact_suppressed_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Suppressed User', '+5511999990055');

  -- Add to suppression list
  INSERT INTO public.suppression_list (organization_id, contact_id, phone_e164, reason)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, v_contact_suppressed_id, '+5511999990055', 'opt_out');

  -- Create 2 queue recipients (1 normal, 1 suppressed)
  INSERT INTO public.campaign_recipients (id, organization_id, campaign_id, contact_id, status, scheduled_at)
  VALUES
    (v_recipient_normal_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid, 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1'::uuid, 'pending', now() - interval '1 minute'),
    (v_recipient_suppressed_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1'::uuid, v_contact_suppressed_id, 'pending', now() - interval '1 minute');

  -- Claim batch as worker node
  FOR v_claimed IN SELECT * FROM public.claim_campaign_recipients('node-oci-01', 10) LOOP
    v_claim_count := v_claim_count + 1;
    ASSERT v_claimed.recipient_id = v_recipient_normal_id, 'TEST 8.1 FAILED: Suppressed contact was erroneously claimed!';
  END LOOP;

  ASSERT v_claim_count = 1, 'TEST 8.2 FAILED: Exactly 1 job should be claimed';

  -- Check that suppressed recipient was auto-marked as 'skipped'
  SELECT status INTO v_skipped_status
  FROM public.campaign_recipients
  WHERE id = v_recipient_suppressed_id;

  ASSERT v_skipped_status = 'skipped', 'TEST 8.3 FAILED: Suppressed recipient was not marked as skipped';

  RAISE NOTICE '>>> TEST 8 PASS: PostgreSQL Queue claim & suppression auto-skip verified.';
END $$;

-- ------------------------------------------------------------
-- TEST 9: Multi-Node Atomic Connection Leases
-- ------------------------------------------------------------
DO $$
DECLARE
  v_conn_id uuid := gen_random_uuid();
  v_lease_result record;
  v_second_node_result record;
  v_renew_result record;
  v_release_ok boolean;
BEGIN
  -- Create dummy connection in Org Alpha
  INSERT INTO public.whatsapp_connections (id, organization_id, label, status)
  VALUES (v_conn_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'Chip Test Lease', 'DISCONNECTED');

  -- Node 1 acquires lease
  SELECT * INTO v_lease_result FROM public.acquire_connection_lease(v_conn_id, 'node-oci-01', 30);
  ASSERT v_lease_result.acquired = true, 'TEST 9.1 FAILED: Node 1 failed to acquire lease';

  -- Node 2 attempts to acquire the same lease (should fail while active)
  SELECT * INTO v_second_node_result FROM public.acquire_connection_lease(v_conn_id, 'node-gcp-01', 30);
  ASSERT v_second_node_result.acquired = false, 'TEST 9.2 FAILED: Node 2 acquired an already-active lease!';

  -- Node 1 renews lease
  SELECT * INTO v_renew_result FROM public.renew_connection_lease(v_conn_id, 'node-oci-01', v_lease_result.lease_token, 60);
  ASSERT v_renew_result.renewed = true, 'TEST 9.3 FAILED: Node 1 failed to renew its active lease';

  -- Node 1 releases lease
  SELECT public.release_connection_lease(v_conn_id, 'node-oci-01', v_lease_result.lease_token) INTO v_release_ok;
  ASSERT v_release_ok = true, 'TEST 9.4 FAILED: Node 1 failed to gracefully release lease';

  -- Now Node 2 can acquire lease
  SELECT * INTO v_second_node_result FROM public.acquire_connection_lease(v_conn_id, 'node-gcp-01', 30);
  ASSERT v_second_node_result.acquired = true, 'TEST 9.5 FAILED: Node 2 failed to acquire released lease';

  RAISE NOTICE '>>> TEST 9 PASS: Atomic connection lease acquire/renew/release verified.';
END $$;

RESET ROLE;
SELECT 'ALL 9 CRITICAL TESTS PASSED SUCCESSFULLY! RLS & ATOMIC INVARIANTS 100% OPERATIONAL.' AS final_status;
