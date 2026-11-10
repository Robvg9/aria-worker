#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/20261110213000_aria_m22_a6_edge_outage_resilient_heartbeat_v1.sql"
TMP_SQL="$(mktemp)"
trap 'rm -f "$TMP_SQL"' EXIT

cat > "$TMP_SQL" <<'SQL'
create schema if not exists aria_internal;
create schema if not exists net;
create schema if not exists vault;

create table aria_internal.mission_wonder_2_a6_telemetry (
  sample_id bigint generated always as identity primary key,
  run_id text not null,
  sampled_at timestamptz not null default now(),
  event_type text not null,
  payload jsonb not null default '{}'::jsonb
);
create table aria_internal.execution_jobs (job_id text primary key);
create table aria_internal.mission_wonder_2_a6_scopes (
  scope_id text primary key, run_id text, status text, ordinal integer
);
create table aria_internal.mission_wonder_2_a6_runs (
  run_id text primary key, status text, completed_at timestamptz, updated_at timestamptz
);
create table aria_internal.test_dispatcher_state (active boolean not null);
insert into aria_internal.test_dispatcher_state values (true);
create table net._http_response (
  id bigint primary key, status_code integer, timed_out boolean, error_msg text, headers jsonb
);
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create table net.test_mode (mode text not null);
insert into net.test_mode values ('ok');

create or replace function aria_internal.aria_m22_a6_monitor_dispatch_http_v1()
returns jsonb language sql as $$ select '{}'::jsonb $$;

create or replace function aria_internal.aria_m22_a6_block_run_v1(
  p_run_id text,p_scope_id text,p_reason text
) returns jsonb language plpgsql as $$
begin
  update aria_internal.mission_wonder_2_a6_runs
     set status='blocked',completed_at=now(),updated_at=now()
   where run_id=p_run_id;
  update aria_internal.mission_wonder_2_a6_scopes
     set status='revoked'
   where run_id=p_run_id and status in ('armed','claimed','bound');
  update aria_internal.test_dispatcher_state set active=false;
  return jsonb_build_object('status','blocked','reason',p_reason);
end;
$$;

create or replace function aria_internal.aria_m22_a6_set_dispatcher_active_v1(p_active boolean)
returns jsonb language plpgsql as $$
begin
  update aria_internal.test_dispatcher_state set active=p_active;
  return '{}'::jsonb;
end;
$$;

create or replace function aria_internal.aria_m22_a6_sample_runtime_v1()
returns jsonb language plpgsql as $$
begin
  insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
  values ('integration-run','heartbeat_sample','{"source":"database"}'::jsonb);
  return jsonb_build_object('status','sampled','run_id','integration-run');
end;
$$;

create or replace function net.http_post(
  url text, headers jsonb, body jsonb, timeout_milliseconds integer
) returns bigint language plpgsql as $$
declare v_mode text;
begin
  select mode into v_mode from net.test_mode limit 1;
  if v_mode='fail' then raise exception 'simulated_pg_net_enqueue_failure'; end if;
  return 9001;
end;
$$;
SQL

awk '
  /^create or replace function aria_internal\.aria_m22_a6_monitor_dispatch_http_v1\(\)/ { copying=1 }
  copying { print }
  copying && /^\$function\$;$/ { exit }
' "$MIGRATION" >> "$TMP_SQL"
awk '
  /^create or replace function aria_internal\.aria_m22_a6_dispatch_tick_v1\(\)/ { copying=1 }
  copying { print }
  copying && /^\$function\$;$/ { exit }
' "$MIGRATION" >> "$TMP_SQL"

cat >> "$TMP_SQL" <<'SQL'
do $$
declare result jsonb;
begin
  -- Case 1: missing Vault token.
  truncate aria_internal.mission_wonder_2_a6_telemetry;
  truncate vault.decrypted_secrets;
  result := aria_internal.aria_m22_a6_dispatch_tick_v1();
  if result->>'status' <> 'sampled_dispatch_failed' then
    raise exception 'missing-token result unexpected: %', result;
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry where event_type='heartbeat_sample') <> 1 then
    raise exception 'missing-token case rolled back heartbeat';
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry where payload->>'event'='dispatch_enqueue_failed') <> 1 then
    raise exception 'missing-token failure telemetry absent';
  end if;
  if (select count(*) from aria_internal.execution_jobs) <> 0
     or (select count(*) from aria_internal.mission_wonder_2_a6_scopes) <> 0 then
    raise exception 'missing-token case unexpectedly touched jobs or scopes';
  end if;

  -- Case 2: pg_net enqueue throws after a valid Vault lookup.
  truncate aria_internal.mission_wonder_2_a6_telemetry;
  insert into vault.decrypted_secrets(name,decrypted_secret)
  values ('aria_autonomy_cron_token','test-token');
  update net.test_mode set mode='fail';
  result := aria_internal.aria_m22_a6_dispatch_tick_v1();
  if result->>'status' <> 'sampled_dispatch_failed' then
    raise exception 'enqueue-failure result unexpected: %', result;
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry where event_type='heartbeat_sample') <> 1 then
    raise exception 'enqueue-failure case rolled back heartbeat';
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry where payload->>'event'='dispatch_enqueue_failed') <> 1 then
    raise exception 'enqueue-failure telemetry absent';
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry
      where payload->>'event'='dispatch_http_result' and payload->>'outcome'='enqueue_failed') <> 1 then
    raise exception 'enqueue failure result missing from circuit-breaker stream';
  end if;
  if (select count(*) from aria_internal.execution_jobs) <> 0
     or (select count(*) from aria_internal.mission_wonder_2_a6_scopes) <> 0 then
    raise exception 'enqueue-failure case unexpectedly touched jobs or scopes';
  end if;
end;
$$;

-- A pending HTTP 2xx must be resolved before evaluating an older failure streak.
insert into aria_internal.mission_wonder_2_a6_runs(run_id,status)
values ('pending-success-run','running');
insert into aria_internal.mission_wonder_2_a6_scopes(scope_id,run_id,status,ordinal)
values ('pending-success-scope','pending-success-run','armed',1);
insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
select 'pending-success-run','dispatcher_event',
       jsonb_build_object('event','dispatch_http_result','outcome','edge_5xx')
from generate_series(1,5);
insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
values ('pending-success-run','dispatcher_event',
        jsonb_build_object('event','dispatch_http_request','request_id',9100));
insert into net._http_response(id,status_code,timed_out,error_msg,headers)
values (9100,200,false,null,'{"cf-ray":"test-success"}'::jsonb);
select aria_internal.aria_m22_a6_monitor_dispatch_http_v1();
do $$
begin
  if (select status from aria_internal.mission_wonder_2_a6_runs where run_id='pending-success-run') <> 'running' then
    raise exception 'pending 2xx did not reset prior failure streak';
  end if;
  if not exists (
    select 1 from aria_internal.mission_wonder_2_a6_telemetry
     where run_id='pending-success-run' and payload->>'event'='dispatch_http_result'
       and payload->>'outcome'='edge_2xx'
  ) then
    raise exception 'pending 2xx response was not recorded';
  end if;
end;
$$;

-- Five consecutive enqueue failures must trip the A6 circuit breaker.
insert into aria_internal.mission_wonder_2_a6_runs(run_id,status)
values ('failure-streak-run','running');
insert into aria_internal.mission_wonder_2_a6_scopes(scope_id,run_id,status,ordinal)
values ('failure-streak-scope','failure-streak-run','armed',1);
insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
select 'failure-streak-run','dispatcher_event',
       jsonb_build_object('event','dispatch_http_result','outcome','enqueue_failed')
from generate_series(1,5);
select aria_internal.aria_m22_a6_monitor_dispatch_http_v1();
do $$
begin
  if (select status from aria_internal.mission_wonder_2_a6_runs where run_id='failure-streak-run') <> 'blocked' then
    raise exception 'five enqueue failures did not block the run';
  end if;
  if (select status from aria_internal.mission_wonder_2_a6_scopes where scope_id='failure-streak-scope') <> 'revoked' then
    raise exception 'blocked run did not revoke armed scope';
  end if;
  if (select active from aria_internal.test_dispatcher_state) is distinct from false then
    raise exception 'blocked run did not deactivate dispatcher';
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry
      where run_id='failure-streak-run' and event_type='fault_observed') <> 1 then
    raise exception 'circuit-breaker fault telemetry missing';
  end if;
end;
$$;
-- Five real Cloudflare 520 responses must also trip the circuit breaker.
insert into aria_internal.mission_wonder_2_a6_runs(run_id,status)
values ('edge-failure-run','running');
insert into aria_internal.mission_wonder_2_a6_scopes(scope_id,run_id,status,ordinal)
values ('edge-failure-scope','edge-failure-run','armed',1);
insert into aria_internal.mission_wonder_2_a6_telemetry(run_id,event_type,payload)
select 'edge-failure-run','dispatcher_event',
       jsonb_build_object('event','dispatch_http_request','request_id',9200+n)
from generate_series(1,5) n;
insert into net._http_response(id,status_code,timed_out,error_msg,headers)
select 9200+n,520,false,'Cloudflare origin error','{"cf-ray":"test-520"}'::jsonb
from generate_series(1,5) n;
select aria_internal.aria_m22_a6_monitor_dispatch_http_v1();
do $$
begin
  if (select status from aria_internal.mission_wonder_2_a6_runs where run_id='edge-failure-run') <> 'blocked' then
    raise exception 'five HTTP 520 responses did not block the run';
  end if;
  if (select status from aria_internal.mission_wonder_2_a6_scopes where scope_id='edge-failure-scope') <> 'revoked' then
    raise exception 'HTTP 520 circuit breaker did not revoke scope';
  end if;
  if (select count(*) from aria_internal.mission_wonder_2_a6_telemetry
      where run_id='edge-failure-run' and event_type='dispatcher_event'
        and payload->>'event'='dispatch_http_result' and payload->>'outcome'='edge_5xx') <> 5 then
    raise exception 'HTTP 520 responses were not recorded as five edge failures';
  end if;
end;
$$;
select 'A6_DISPATCH_SUBTRANSACTION_POSTGRES_INTEGRATION=PASS';
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TMP_SQL"
