-- Minimal Supabase objects required to execute the Voice V4 migration in an isolated CI database.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;

CREATE SCHEMA extensions;
CREATE EXTENSION pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA aria_internal;
CREATE TABLE aria_internal.device_registry (
  device_id text PRIMARY KEY,
  display_name text,
  agent_type text,
  status text NOT NULL DEFAULT 'offline'
    CHECK (status IN ('pending','online','offline','disabled')),
  token_hash text,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT USAGE ON SCHEMA aria_internal TO service_role;
