create table if not exists aria_internal.self_audit_runs (
  run_id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','completed','failed')),
  scope jsonb not null default '{}'::jsonb,
  audit_packet_hash text,
  reviewers jsonb not null default '[]'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  synthesis jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table aria_internal.self_audit_runs enable row level security;
revoke all on table aria_internal.self_audit_runs from public, anon, authenticated;
grant all on table aria_internal.self_audit_runs to service_role;

create or replace function aria_internal.self_audit_record(p_run jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $$
declare
  v_id uuid;
begin
  v_id := coalesce(nullif(p_run->>'run_id','')::uuid, gen_random_uuid());
  insert into aria_internal.self_audit_runs(run_id,status,scope,audit_packet_hash,reviewers,findings,synthesis,evidence,finished_at,updated_at)
  values(
    v_id,
    coalesce(nullif(p_run->>'status',''),'running'),
    coalesce(p_run->'scope','{}'::jsonb),
    p_run->>'audit_packet_hash',
    coalesce(p_run->'reviewers','[]'::jsonb),
    coalesce(p_run->'findings','[]'::jsonb),
    coalesce(p_run->'synthesis','{}'::jsonb),
    coalesce(p_run->'evidence','{}'::jsonb),
    case when p_run ? 'finished_at' and p_run->>'finished_at' is not null then (p_run->>'finished_at')::timestamptz else null end,
    now()
  )
  on conflict(run_id) do update set
    status=excluded.status,
    scope=excluded.scope,
    audit_packet_hash=excluded.audit_packet_hash,
    reviewers=excluded.reviewers,
    findings=excluded.findings,
    synthesis=excluded.synthesis,
    evidence=excluded.evidence,
    finished_at=excluded.finished_at,
    updated_at=now();
  return v_id;
end;
$$;

revoke all on function aria_internal.self_audit_record(jsonb) from public, anon, authenticated;
grant execute on function aria_internal.self_audit_record(jsonb) to service_role, postgres;
