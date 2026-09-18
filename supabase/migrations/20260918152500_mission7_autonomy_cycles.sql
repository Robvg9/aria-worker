-- Mission 7/7 — Autonomous cycle evidence
create table if not exists aria_internal.autonomy_cycles (
  cycle_id text primary key,
  cycle_slot timestamptz not null,
  trigger text not null default 'manual',
  status text not null default 'started',
  policy_version text not null default 'autonomy-post-plan-v1',
  active_missions_count integer not null default 0,
  goals_scanned integer not null default 0,
  failures_scanned integer not null default 0,
  capability_gaps_scanned integer not null default 0,
  learnings_scanned integer not null default 0,
  candidates_generated integer not null default 0,
  candidates_inserted integer not null default 0,
  selected_goal_id text,
  created_mission_id text,
  mission_status text,
  learning_result jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists autonomy_cycles_created_at_idx on aria_internal.autonomy_cycles(created_at desc);
create index if not exists autonomy_cycles_selected_goal_idx on aria_internal.autonomy_cycles(selected_goal_id);
alter table aria_internal.autonomy_cycles enable row level security;
revoke all on aria_internal.autonomy_cycles from anon, authenticated;
grant all on aria_internal.autonomy_cycles to service_role;
