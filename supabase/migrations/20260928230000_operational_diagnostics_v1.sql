-- ARIA Phase 5 — Operational Diagnostics v1
-- Canonical correlation/evidence fields for mission events plus persisted diagnostic snapshots.

alter table aria_internal.mission_events
  add column if not exists trace_id text,
  add column if not exists span_id text,
  add column if not exists request_id text,
  add column if not exists execution_id text,
  add column if not exists error_code text,
  add column if not exists runtime_version text,
  add column if not exists source_sha text;

create index if not exists mission_events_trace_idx
  on aria_internal.mission_events(trace_id, created_at desc);

create index if not exists mission_events_execution_idx
  on aria_internal.mission_events(execution_id, created_at desc);

create index if not exists mission_events_error_idx
  on aria_internal.mission_events(error_code, created_at desc);

create table if not exists aria_internal.mission_diagnostics (
  mission_id text primary key references aria_internal.mission_state(mission_id) on delete cascade,
  diagnostic_version text not null default 'aria-operational-diagnostics-v1.0.0',
  correlation jsonb not null default '{}'::jsonb,
  classification jsonb not null default '{}'::jsonb,
  diagnosis jsonb not null default '{}'::jsonb,
  versions jsonb not null default '{}'::jsonb,
  attempts jsonb not null default '[]'::jsonb,
  evidence_chain jsonb not null default '[]'::jsonb,
  health jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mission_diagnostics_classification_idx
  on aria_internal.mission_diagnostics((classification->>'category'), updated_at desc);

create index if not exists mission_diagnostics_updated_idx
  on aria_internal.mission_diagnostics(updated_at desc);

alter table aria_internal.mission_diagnostics enable row level security;

create or replace function aria_internal.enrich_mission_event_diagnostics()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
declare
  v_meta jsonb := '{}'::jsonb;
  v_trace text;
  v_request text;
  v_execution text;
  v_error text;
  v_runtime text;
  v_source_sha text;
  v_span text;
  v_payload jsonb := coalesce(new.payload, '{}'::jsonb);
begin
  select coalesce(metadata, '{}'::jsonb)
    into v_meta
    from aria_internal.mission_state
   where mission_id = new.mission_id;

  v_trace := nullif(coalesce(v_payload->>'trace_id', v_meta->>'trace_id'), '');
  v_request := nullif(coalesce(v_payload->>'request_id', v_meta->>'request_id'), '');
  v_execution := nullif(coalesce(
    v_payload->>'execution_id',
    v_payload->>'job_id',
    v_meta->>'execution_id'
  ), '');
  v_error := nullif(coalesce(
    v_payload->>'error_code',
    v_payload->'error'->>'code',
    v_payload->'failure'->>'error_code',
    v_payload->>'reason'
  ), '');
  v_runtime := nullif(coalesce(
    v_payload->>'runtime_version',
    v_meta->>'runtime_version',
    'aria-mission-runner-v22-universal'
  ), '');
  v_source_sha := nullif(coalesce(
    v_payload->>'source_sha',
    v_meta->>'release_sha',
    v_meta->>'source_sha'
  ), '');

  v_span := nullif(coalesce(v_payload->>'span_id', ''), '');
  if v_span is null then
    v_span := md5(
      coalesce(v_trace, 'mission:' || new.mission_id)
      || ':' || coalesce(new.event_type, 'event')
      || ':' || coalesce(new.step_index::text, '0')
      || ':' || clock_timestamp()::text
    );
  end if;

  new.trace_id := v_trace;
  new.request_id := v_request;
  new.execution_id := v_execution;
  new.error_code := left(v_error, 240);
  new.runtime_version := v_runtime;
  new.source_sha := v_source_sha;
  new.span_id := v_span;

  new.payload :=
    v_payload || jsonb_strip_nulls(
      jsonb_build_object(
        'trace_id', v_trace,
        'span_id', v_span,
        'request_id', v_request,
        'execution_id', v_execution,
        'error_code', left(v_error, 240),
        'runtime_version', v_runtime,
        'source_sha', v_source_sha
      )
    );

  return new;
end;
$function$;

drop trigger if exists mission_events_diagnostic_enrichment on aria_internal.mission_events;

create trigger mission_events_diagnostic_enrichment
before insert on aria_internal.mission_events
for each row execute function aria_internal.enrich_mission_event_diagnostics();

comment on table aria_internal.mission_diagnostics is
  'Canonical persisted operational diagnosis: correlation, classification, human explanation, attempt history, evidence chain, versions and health.';

comment on column aria_internal.mission_events.trace_id is
  'Canonical end-to-end trace correlation identifier, inherited from mission metadata when absent on the event.';

comment on column aria_internal.mission_events.source_sha is
  'Optional release/source SHA when the caller propagates one; runtime_version remains mandatory diagnostic identity.';

create index if not exists mission_state_status_updated_idx
  on aria_internal.mission_state(status, updated_at desc);

create index if not exists execution_jobs_status_updated_idx
  on aria_internal.execution_jobs(status, updated_at desc);

create index if not exists model_registry_status_enabled_idx
  on aria_internal.model_registry(status, enabled);

create or replace function aria_internal.get_operational_health_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','aria_internal'
as $function$
with stats as (
  select
    (select count(*) from aria_internal.mission_state where status in ('planning','running','waiting')) as active_missions,
    (select count(*) from aria_internal.mission_state where status='blocked') as blocked_missions,
    (select count(*) from aria_internal.mission_state where status='failed' and updated_at >= clock_timestamp()-interval '24 hours') as failed_24h,
    (select count(*) from aria_internal.execution_jobs where status='queued') as queued_jobs,
    (select count(*) from aria_internal.execution_jobs where status in ('claimed','running')) as running_jobs,
    (select count(*) from aria_internal.execution_jobs where status in ('claimed','running') and updated_at < clock_timestamp()-interval '10 minutes') as stale_jobs,
    (select count(*) from aria_internal.device_registry where status='online') as devices_online,
    (select count(*) from aria_internal.device_registry) as devices_total,
    (select count(*) from aria_internal.model_registry where enabled=true and status='available') as models_available,
    (select count(*) from aria_internal.model_registry) as models_total
)
select jsonb_build_object(
  'version','aria-operational-diagnostics-v1.0.0',
  'generated_at',clock_timestamp(),
  'status',case
    when stale_jobs > 0 or blocked_missions > 0 or failed_24h > 0 then 'degraded'
    when queued_jobs > 0 and devices_online = 0 then 'unavailable'
    else 'healthy'
  end,
  'observed',true,
  'scope','system',
  'summary',jsonb_build_object(
    'active_missions',active_missions,
    'blocked_missions',blocked_missions,
    'failed_24h',failed_24h,
    'queued_jobs',queued_jobs,
    'running_jobs',running_jobs,
    'stale_jobs',stale_jobs,
    'devices_online',devices_online,
    'devices_total',devices_total,
    'models_available',models_available,
    'models_total',models_total
  ),
  'dependencies',jsonb_build_object(
    'device_transport',jsonb_build_object(
      'status',case when devices_online > 0 then 'healthy' else 'unavailable' end,
      'online',devices_online,'total',devices_total
    ),
    'model_runtime',jsonb_build_object(
      'status',case when models_available > 0 then 'healthy' else 'unavailable' end,
      'available',models_available,'total',models_total
    ),
    'job_queue',jsonb_build_object(
      'status',case when stale_jobs > 0 then 'degraded' else 'healthy' end,
      'queued',queued_jobs,'running',running_jobs,'stale',stale_jobs
    )
  ),
  'next_actions',
    case
      when stale_jobs > 0 then jsonb_build_array('Inspeccionar jobs stale y la evidencia del watchdog.')
      when blocked_missions > 0 then jsonb_build_array('Revisar las misiones bloqueadas desde el panel de diagnóstico.')
      when queued_jobs > 0 and devices_online = 0 then jsonb_build_array('Restaurar un executor de dispositivo online antes de esperar progreso.')
      else jsonb_build_array('No se requiere una acción operativa inmediata.')
    end
)
from stats;
$function$;

revoke all on function aria_internal.get_operational_health_v1() from public,anon,authenticated;
grant execute on function aria_internal.get_operational_health_v1() to service_role;
