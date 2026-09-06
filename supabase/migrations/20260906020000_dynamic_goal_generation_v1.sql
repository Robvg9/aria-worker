-- Dynamic Goal Generation v1 extends the canonical autonomy_goals authority.
alter table aria_internal.autonomy_goals
  add column if not exists source_type text not null default 'seed',
  add column if not exists source_ref text,
  add column if not exists dynamic_score numeric,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists autonomy_goals_dynamic_score_idx
  on aria_internal.autonomy_goals (status, next_run_at, dynamic_score desc);

create index if not exists autonomy_goals_source_idx
  on aria_internal.autonomy_goals (source_type, source_ref);

comment on column aria_internal.autonomy_goals.source_type is 'Canonical provenance of goal selection: seed, roadmap, priority, capability_gap, failure, learning.';
comment on column aria_internal.autonomy_goals.source_ref is 'Non-secret reference to the source evidence that produced this goal.';
comment on column aria_internal.autonomy_goals.dynamic_score is 'Deterministic runtime score used only for autonomous goal prioritization.';
comment on column aria_internal.autonomy_goals.metadata is 'Non-secret provenance and dynamic-goal context; never stores credentials or secret values.';
