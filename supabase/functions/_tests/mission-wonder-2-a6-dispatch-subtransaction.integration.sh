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
  event_type text not null,
  payload jsonb not null default '{}'::jsonb
);
create table aria_internal.execution_jobs (job_id text primary key);
create table aria_internal.mission_wonder_2_a6_scopes (scope_id text primary key);
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create table net.test_mode (mode text not null);
insert into net.test_mode values ('ok');

create or replace function aria_internal.aria_m22_a6_monitor_dispatch_http_v1()
returns jsonb language sql as $$ select '{}'::jsonb $$;

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
  if (select count(*) from aria_internal.execution_jobs) <> 0
     or (select count(*) from aria_internal.mission_wonder_2_a6_scopes) <> 0 then
    raise exception 'enqueue-failure case unexpectedly touched jobs or scopes';
  end if;
end;
$$;
select 'A6_DISPATCH_SUBTRANSACTION_POSTGRES_INTEGRATION=PASS';
SQL

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$TMP_SQL"
