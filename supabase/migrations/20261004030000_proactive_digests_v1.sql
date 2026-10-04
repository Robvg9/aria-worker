-- ARIA Proactive Intelligence LIVE v1
-- Read-only consumer with deterministic persisted digests. No mission/job state mutation.

create table if not exists aria_internal.proactive_digests (
  digest_id text primary key,
  engine_version text not null,
  action_mode text not null check (action_mode = 'recommendation_only'),
  observed_at timestamptz not null,
  fingerprint text not null,
  snapshot jsonb not null,
  digest jsonb not null,
  source_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists proactive_digests_observed_idx
  on aria_internal.proactive_digests(observed_at desc);

create index if not exists proactive_digests_fingerprint_idx
  on aria_internal.proactive_digests(fingerprint, observed_at desc);

alter table aria_internal.proactive_digests enable row level security;

revoke all on aria_internal.proactive_digests from public, anon, authenticated;
grant select, insert on aria_internal.proactive_digests to service_role;

comment on table aria_internal.proactive_digests is
  'Persisted deterministic read-only Proactive Intelligence digests. Never an execution authority.';
