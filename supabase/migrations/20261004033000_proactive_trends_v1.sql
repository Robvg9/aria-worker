create table if not exists aria_internal.proactive_trends (
  trend_id text primary key,
  engine_version text not null,
  action_mode text not null check (action_mode = 'recommendation_only'),
  generated_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  fingerprint text not null,
  trend_count integer not null,
  persistent_count integer not null,
  recurring_count integer not null,
  new_count integer not null,
  trends jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists proactive_trends_generated_idx
  on aria_internal.proactive_trends(generated_at desc);

alter table aria_internal.proactive_trends enable row level security;
revoke all on aria_internal.proactive_trends from public, anon, authenticated;
grant select, insert on aria_internal.proactive_trends to service_role;

comment on table aria_internal.proactive_trends is
  'Persisted deterministic Proactive Trend Intelligence digests. Read-only recommendation analytics; never execution authority.';
