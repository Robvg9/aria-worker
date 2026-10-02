create table if not exists aria_internal.capability_absorptions (
  absorption_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_type text not null,
  source_ref text not null,
  source_owner text not null,
  source_repo text not null,
  source_requested_ref text,
  source_commit_sha text,
  source_digest_sha256 text,
  resource_name text not null,
  status text not null default 'DISCOVERED',
  enabled boolean not null default false,
  inventory jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '[]'::jsonb,
  absorption_plan jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  runtime_binding jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capability_absorptions_status_ck check (status in ('DISCOVERED','INSPECTED','INDEXED','SANDBOXED','VERIFIED','REGISTERED','ENABLED','DISABLED','REJECTED','DEPRECATED'))
);
create index if not exists capability_absorptions_user_updated_idx on aria_internal.capability_absorptions(user_id, updated_at desc);
create index if not exists capability_absorptions_source_idx on aria_internal.capability_absorptions(source_type, source_owner, source_repo, source_commit_sha);
alter table aria_internal.capability_absorptions enable row level security;
revoke all on aria_internal.capability_absorptions from public, anon, authenticated;
grant select, insert, update on aria_internal.capability_absorptions to service_role;
create or replace function aria_internal.touch_capability_absorption() returns trigger language plpgsql security definer set search_path = '' as $$
begin new.updated_at = clock_timestamp(); return new; end; $$;
drop trigger if exists capability_absorptions_touch on aria_internal.capability_absorptions;
create trigger capability_absorptions_touch before update on aria_internal.capability_absorptions for each row execute function aria_internal.touch_capability_absorption();
comment on table aria_internal.capability_absorptions is 'ARIA ABSORB v1 governed capability acquisition ledger. External source code is never executed by this lifecycle; runtime enablement requires an allowlisted ARIA binding.';