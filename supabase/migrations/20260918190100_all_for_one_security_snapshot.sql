begin;

create or replace function aria_internal.get_all_for_one_security_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to pg_catalog, aria_internal
as $$
declare
  definer_anon integer;
  definer_auth integer;
  mutable_path integer;
  rls_no_policy integer;
begin
  select count(*) filter (where has_function_privilege('anon',p.oid,'EXECUTE'))::int,
         count(*) filter (where has_function_privilege('authenticated',p.oid,'EXECUTE'))::int
    into definer_anon,definer_auth
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where p.prosecdef and n.nspname='aria_internal';

  select count(*)::int into mutable_path
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='aria_internal'
     and p.prosecdef
     and (p.proconfig is null or not exists (
       select 1 from unnest(p.proconfig) c where c like 'search_path=%'
     ));

  select count(*)::int into rls_no_policy
    from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='aria_internal'
     and c.relkind='r'
     and c.relrowsecurity
     and not exists(select 1 from pg_policy pol where pol.polrelid=c.oid);

  return jsonb_build_object(
    'security_definer_anon_execute',definer_anon,
    'security_definer_authenticated_execute',definer_auth,
    'security_definer_without_explicit_search_path',mutable_path,
    'rls_tables_without_policy',rls_no_policy
  );
end;
$$;

revoke all on function aria_internal.get_all_for_one_security_snapshot() from public, anon, authenticated;
grant execute on function aria_internal.get_all_for_one_security_snapshot() to service_role;

commit;