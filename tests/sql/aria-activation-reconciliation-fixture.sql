-- Minimal PostgreSQL 17 fixture for the ARIA activation/reconciliation migration.
-- This is intentionally isolated from Supabase production and contains synthetic rows only.
CREATE SCHEMA aria_internal;

CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE TABLE aria_internal.vision_objectives (
  objective_id text PRIMARY KEY,
  status text NOT NULL
);

CREATE TABLE aria_internal.autonomy_goals (
  goal_id text PRIMARY KEY,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  next_run_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_mission_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  objective_verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  objective_verification_reason text,
  objective_verification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  objective_verified_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE aria_internal.mission_state (
  mission_id text PRIMARY KEY,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_stderr text,
  last_recovery_reason text,
  recovery_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  next_action text
);

CREATE TABLE aria_internal.meditation_queue (
  queue_id text PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('goal','mission')),
  item_id text NOT NULL,
  resolved_mission_id text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','paused','completed','failed','blocked','cancelled')),
  last_error text,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Dependencies and semantic-verification routines already exist in the production schema.
-- Small deterministic stubs make the new functions executable in this isolated fixture.
CREATE FUNCTION aria_internal.resolve_dependency_goal_id(p_dependency_id text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT p_dependency_id;
$$;

CREATE FUNCTION aria_internal.verify_objective_fulfilled_v9(p_goal_id text)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'status', 'CONFIRMED',
    'reason', 'Synthetic PostgreSQL integration fixture confirmed objective'
  );
$$;
