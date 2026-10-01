-- ============================================================
-- Migration 00014: Seed Admin User & Default Organization
-- ============================================================
-- Configures:
--   - Admin User: disparomassa21@gmail.com / abc12345
--   - Role: ADMIN
--   - Profile in public.profiles
--   - Default Organization: DLM WhatsApp
--   - Organization Membership with ADMIN role
-- ============================================================

DO $$
DECLARE
  v_admin_email text := 'disparomassa21@gmail.com';
  v_admin_pass  text := 'abc12345';
  v_admin_id    uuid;
  v_org_id      uuid;
BEGIN
  -- 1. Verifica se a tabela auth.users existe (ambiente Supabase)
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') AND
     EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN

    SELECT id INTO v_admin_id
    FROM auth.users
    WHERE email = v_admin_email
    LIMIT 1;

    IF v_admin_id IS NULL THEN
      v_admin_id := gen_random_uuid();

      INSERT INTO auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) VALUES (
        v_admin_id,
        '00000000-0000-0000-0000-000000000000',
        'authenticated',
        'authenticated',
        v_admin_email,
        crypt(v_admin_pass, gen_salt('bf')),
        now(),
        '{"provider": "email", "providers": ["email"]}'::jsonb,
        '{"role": "ADMIN", "name": "Administrador Master", "full_name": "Administrador Master"}'::jsonb,
        now(),
        now()
      );
    ELSE
      -- Atualiza metadados e senha do admin caso já exista
      UPDATE auth.users
      SET encrypted_password = crypt(v_admin_pass, gen_salt('bf')),
          raw_user_meta_data = raw_user_meta_data || '{"role": "ADMIN", "name": "Administrador Master"}'::jsonb,
          email_confirmed_at = COALESCE(email_confirmed_at, now()),
          updated_at = now()
      WHERE id = v_admin_id;
    END IF;

    -- 2. Garante o Profile em public.profiles
    INSERT INTO public.profiles (id, full_name, created_at, updated_at)
    VALUES (v_admin_id, 'Administrador Master', now(), now())
    ON CONFLICT (id) DO UPDATE SET
      full_name = 'Administrador Master',
      updated_at = now();

    -- 3. Garante a Organização Padrão
    SELECT id INTO v_org_id
    FROM public.organizations
    WHERE slug = 'dlm-whatsapp'
    LIMIT 1;

    IF v_org_id IS NULL THEN
      v_org_id := gen_random_uuid();
      INSERT INTO public.organizations (id, name, slug, owner_id, status, created_at, updated_at)
      VALUES (v_org_id, 'DLM WhatsApp', 'dlm-whatsapp', v_admin_id, 'active', now(), now());
    END IF;

    -- 4. Garante a Membresia de ADMIN na Organização
    INSERT INTO public.organization_members (organization_id, user_id, role, created_at)
    VALUES (v_org_id, v_admin_id, 'ADMIN', now())
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = 'ADMIN';

    RAISE NOTICE 'Admin user seeded: % (UUID: %)', v_admin_email, v_admin_id;
  END IF;
END $$;
