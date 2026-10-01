-- ============================================================
-- Migration 00001: Extensions & Shared Trigger Functions
-- ============================================================
-- Creates:
--   - Required extensions: pgcrypto, uuid-ossp
--   - Central set_updated_at() trigger function
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- set_updated_at() — Central trigger function for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Central trigger function: sets updated_at = now() on UPDATE. Attach via trigger to any table with updated_at column.';
