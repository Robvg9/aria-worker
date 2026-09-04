-- ARIA Autonomous Execution Fabric — AF-3 Device Execution Registry + Jobs
CREATE TABLE IF NOT EXISTS aria_internal.device_registry (
  device_id text PRIMARY KEY,
  display_name text NOT NULL,
  agent_type text NOT NULL,
  status text NOT NULL DEFAULT 'offline' CHECK (status IN ('pending','online','offline','disabled')),
  token_hash text NOT NULL,
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aria_internal.execution_jobs (
  job_id text PRIMARY KEY,
  mission_id text NOT NULL REFERENCES aria_internal.mission_state(mission_id) ON DELETE CASCADE,
  device_id text REFERENCES aria_internal.device_registry(device_id) ON DELETE SET NULL,
  operation text NOT NULL,
  command text NOT NULL,
  cwd text,
  timeout_ms integer NOT NULL DEFAULT 120000 CHECK (timeout_ms > 0 AND timeout_ms <= 3600000),
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','running','succeeded','failed','timeout','cancelled','blocked')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  exit_code integer,
  stdout text,
  stderr text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS aria_internal.execution_job_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id text NOT NULL REFERENCES aria_internal.execution_jobs(job_id) ON DELETE CASCADE,
  device_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_registry_status_idx ON aria_internal.device_registry(status);
CREATE INDEX IF NOT EXISTS execution_jobs_claim_idx ON aria_internal.execution_jobs(status, requested_at);
CREATE INDEX IF NOT EXISTS execution_jobs_mission_idx ON aria_internal.execution_jobs(mission_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS execution_jobs_device_idx ON aria_internal.execution_jobs(device_id);
CREATE INDEX IF NOT EXISTS execution_job_events_job_idx ON aria_internal.execution_job_events(job_id, created_at DESC);

ALTER TABLE aria_internal.device_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.execution_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.execution_job_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION aria_internal.claim_execution_job(p_device_id text)
RETURNS SETOF aria_internal.execution_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = aria_internal, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  UPDATE aria_internal.execution_jobs j
  SET device_id = p_device_id,
      status = 'claimed',
      claimed_at = now(),
      updated_at = now()
  WHERE j.job_id = (
    SELECT q.job_id
    FROM aria_internal.execution_jobs q
    WHERE q.status = 'queued'
      AND (q.device_id IS NULL OR q.device_id = p_device_id)
    ORDER BY q.requested_at, q.job_id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.*;
END;
$$;
