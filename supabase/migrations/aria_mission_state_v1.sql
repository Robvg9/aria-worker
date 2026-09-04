-- ARIA Autonomous Execution Fabric — AF-2 Mission State / Checkpoint Persistence
CREATE TABLE IF NOT EXISTS aria_internal.mission_state (
  mission_id text PRIMARY KEY,
  goal text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','planning','running','waiting','blocked','paused','failed','succeeded','cancelled')),
  current_step integer NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  total_steps integer CHECK (total_steps IS NULL OR total_steps >= 0),
  completed_steps integer NOT NULL DEFAULT 0 CHECK (completed_steps >= 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  current_agent_id text,
  current_workspace text,
  last_command text,
  last_exit_code integer,
  last_stdout text,
  last_stderr text,
  next_action text,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS aria_internal.mission_steps (
  mission_id text NOT NULL REFERENCES aria_internal.mission_state(mission_id) ON DELETE CASCADE,
  step_index integer NOT NULL CHECK (step_index >= 1),
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','waiting','blocked','failed','succeeded','skipped')),
  agent_id text,
  operation text,
  command text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mission_id, step_index)
);

CREATE TABLE IF NOT EXISTS aria_internal.mission_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mission_id text NOT NULL REFERENCES aria_internal.mission_state(mission_id) ON DELETE CASCADE,
  step_index integer CHECK (step_index IS NULL OR step_index >= 1),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mission_state_status_idx ON aria_internal.mission_state(status);
CREATE INDEX IF NOT EXISTS mission_state_updated_idx ON aria_internal.mission_state(updated_at DESC);
CREATE INDEX IF NOT EXISTS mission_steps_status_idx ON aria_internal.mission_steps(mission_id, status);
CREATE INDEX IF NOT EXISTS mission_events_mission_idx ON aria_internal.mission_events(mission_id, created_at DESC);

ALTER TABLE aria_internal.mission_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.mission_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.mission_events ENABLE ROW LEVEL SECURITY;
