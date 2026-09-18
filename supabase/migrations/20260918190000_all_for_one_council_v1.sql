begin;

create table if not exists aria_internal.all_for_one_runs (
  run_id uuid primary key default gen_random_uuid(),
  protocol_version text not null default 'all-for-one-v1',
  status text not null default 'queued',
  phase text not null default 'inventory',
  target_ref text not null default 'main',
  target_commit text,
  scope jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  error text
);

create table if not exists aria_internal.all_for_one_auditors (
  auditor_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references aria_internal.all_for_one_runs(run_id) on delete cascade,
  auditor_type text not null,
  auditor_key text not null,
  model_id text,
  status text not null default 'queued',
  attempt integer not null default 0,
  evidence_mode text not null default 'snapshot',
  report text,
  evidence jsonb not null default '{}'::jsonb,
  verdict text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique(run_id,auditor_type,auditor_key)
);

create table if not exists aria_internal.all_for_one_reviews (
  review_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references aria_internal.all_for_one_runs(run_id) on delete cascade,
  reviewer_type text not null,
  reviewer_key text not null,
  model_id text,
  status text not null default 'queued',
  review text,
  verdict text,
  target_findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id,reviewer_type,reviewer_key)
);

create index if not exists all_for_one_auditors_run_status_idx
  on aria_internal.all_for_one_auditors(run_id,status);
create index if not exists all_for_one_reviews_run_status_idx
  on aria_internal.all_for_one_reviews(run_id,status);

alter table aria_internal.all_for_one_runs enable row level security;
alter table aria_internal.all_for_one_auditors enable row level security;
alter table aria_internal.all_for_one_reviews enable row level security;

revoke all on aria_internal.all_for_one_runs from anon, authenticated;
revoke all on aria_internal.all_for_one_auditors from anon, authenticated;
revoke all on aria_internal.all_for_one_reviews from anon, authenticated;
grant all on aria_internal.all_for_one_runs to service_role;
grant all on aria_internal.all_for_one_auditors to service_role;
grant all on aria_internal.all_for_one_reviews to service_role;

commit;