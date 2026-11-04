-- Mission Wonder 2 / Step 4 A4: one authenticated PWA-originated, read-only execution.
-- Never unfreezes ordinary missions and never manually inserts mission/job rows.
begin;
create table if not exists aria_internal.mission_wonder_2_a4_scopes (
  scope_id text primary key, scope_key text not null unique, owner_user_id text not null,
  request_id text, goal_hash text not null check (goal_hash ~ '^[0-9a-f]{64}$'),
  mission_id text not null unique, allowed_device_id text not null,
  status text not null default 'armed' check (status in ('armed','claimed','bound','completed','revoked')),
  expires_at timestamptz not null, claimed_at timestamptz, bound_at timestamptz,
  completed_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  check (request_id is null or length(request_id) between 1 and 200)
);
create unique index if not exists mission_wonder_2_a4_request_uidx
  on aria_internal.mission_wonder_2_a4_scopes(request_id) where request_id is not null;
alter table aria_internal.mission_wonder_2_a4_scopes enable row level security;
revoke all on aria_internal.mission_wonder_2_a4_scopes from public,anon,authenticated;
grant select,insert,update on aria_internal.mission_wonder_2_a4_scopes to service_role;
create or replace function aria_internal.aria_m22_a4_claim_scope_v1(p_user_id text,p_request_id text,p_goal_hash text,p_project_id text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','aria_internal'
as $function$
declare s aria_internal.mission_wonder_2_a4_scopes;
begin
  if nullif(btrim(p_user_id),'') is null or nullif(btrim(p_request_id),'') is null or length(p_request_id)>200
    or p_goal_hash is null or p_goal_hash !~ '^[0-9a-f]{64}$' or p_project_id is not null then return null; end if;
  select * into s from aria_internal.mission_wonder_2_a4_scopes
   where owner_user_id=btrim(p_user_id) and goal_hash=p_goal_hash and status in ('armed','claimed','bound')
     and expires_at>clock_timestamp() order by created_at asc limit 1 for update;
  if not found then return null; end if;
  if s.status='armed' then
    update aria_internal.mission_wonder_2_a4_scopes set request_id=btrim(p_request_id),status='claimed',
      claimed_at=clock_timestamp(),updated_at=clock_timestamp() where scope_id=s.scope_id returning * into s;
  elsif s.request_id is distinct from btrim(p_request_id) then return null; end if;
  return jsonb_build_object('scope_id',s.scope_id,'mission_id',s.mission_id,'allowed_device_id',s.allowed_device_id,'status',s.status,'expires_at',s.expires_at);
end;
$function$;
create or replace function aria_internal.aria_m22_a4_bind_scope_v1(p_scope_id text,p_mission_id text,p_user_id text,p_request_id text,p_goal_hash text)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','aria_internal'
as $function$
declare updated_count integer;
begin
  if not exists(select 1 from aria_internal.mission_state m where m.mission_id=p_mission_id
    and m.metadata->>'mission_wonder_2_a4_scope_id'=p_scope_id and m.metadata->>'user_id'=p_user_id
    and m.metadata->>'request_id'=p_request_id and m.metadata->>'mission_wonder_2_a4_goal_hash'=p_goal_hash
    and m.metadata->>'mission_wonder_2_a4_readonly'='true') then return false; end if;
  update aria_internal.mission_wonder_2_a4_scopes set status='bound',bound_at=coalesce(bound_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and mission_id=p_mission_id and owner_user_id=p_user_id and request_id=p_request_id
     and goal_hash=p_goal_hash and status in ('claimed','bound') and expires_at>clock_timestamp();
  get diagnostics updated_count=row_count;
  if updated_count=1 then return true; end if;
  return exists(select 1 from aria_internal.mission_wonder_2_a4_scopes where scope_id=p_scope_id and mission_id=p_mission_id
    and owner_user_id=p_user_id and request_id=p_request_id and goal_hash=p_goal_hash and status='completed');
end;
$function$;
create or replace function aria_internal.aria_m22_a4_complete_scope_v1(p_scope_id text,p_mission_id text,p_user_id text,p_request_id text)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','aria_internal'
as $function$
declare updated_count integer;
begin
  update aria_internal.mission_wonder_2_a4_scopes set status='completed',completed_at=coalesce(completed_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and mission_id=p_mission_id and owner_user_id=p_user_id and request_id=p_request_id and status='bound';
  get diagnostics updated_count=row_count;
  if updated_count=1 then return true; end if;
  return exists(select 1 from aria_internal.mission_wonder_2_a4_scopes where scope_id=p_scope_id and mission_id=p_mission_id
    and owner_user_id=p_user_id and request_id=p_request_id and status='completed');
end;
$function$;
create or replace function aria_internal.aria_m22_a4_revoke_scope_v1(p_scope_id text)
returns boolean language plpgsql security definer set search_path to 'pg_catalog','aria_internal'
as $function$
declare updated_count integer;
begin
  update aria_internal.mission_wonder_2_a4_scopes set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()),updated_at=clock_timestamp()
   where scope_id=p_scope_id and status in ('armed','claimed','bound','completed');
  get diagnostics updated_count=row_count;
  return updated_count=1 or exists(select 1 from aria_internal.mission_wonder_2_a4_scopes where scope_id=p_scope_id and status='revoked');
end;
$function$;
revoke all on function aria_internal.aria_m22_a4_claim_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a4_bind_scope_v1(text,text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a4_complete_scope_v1(text,text,text,text) from public,anon,authenticated;
revoke all on function aria_internal.aria_m22_a4_revoke_scope_v1(text) from public,anon,authenticated;
grant execute on function aria_internal.aria_m22_a4_claim_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a4_bind_scope_v1(text,text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a4_complete_scope_v1(text,text,text,text) to service_role;
grant execute on function aria_internal.aria_m22_a4_revoke_scope_v1(text) to service_role;
commit;
