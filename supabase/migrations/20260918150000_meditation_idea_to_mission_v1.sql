create table if not exists aria_internal.meditation_idea_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  idea text not null check (length(btrim(idea)) between 1 and 4000),
  schema_version text not null default 'idea-to-mission-v1',
  status text not null default 'proposed'
    check (status in ('proposed','accepted','rejected','converted')),
  classification jsonb not null default '{}'::jsonb,
  objective jsonb not null default '{}'::jsonb,
  subobjectives jsonb not null default '[]'::jsonb,
  missions jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  auto_enqueued boolean not null default false
    check (auto_enqueued = false),
  source_device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meditation_idea_proposals_status_created_idx
  on aria_internal.meditation_idea_proposals(status, created_at desc);

create index if not exists meditation_idea_proposals_device_created_idx
  on aria_internal.meditation_idea_proposals(source_device_id, created_at desc);

alter table aria_internal.meditation_idea_proposals enable row level security;

revoke all on aria_internal.meditation_idea_proposals from anon, authenticated;
grant select, insert, update on aria_internal.meditation_idea_proposals to service_role;

drop trigger if exists trg_meditation_idea_proposals_updated_at on aria_internal.meditation_idea_proposals;
create or replace function aria_internal.touch_meditation_idea_proposal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, aria_internal
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function aria_internal.touch_meditation_idea_proposal() from public, anon, authenticated;
grant execute on function aria_internal.touch_meditation_idea_proposal() to service_role;

create trigger trg_meditation_idea_proposals_updated_at
before update on aria_internal.meditation_idea_proposals
for each row execute function aria_internal.touch_meditation_idea_proposal();
