-- ARIA Proactive Intelligence LIVE refresh v1
-- Uses existing Supabase capacity: no new Edge Function required.

create or replace function aria_internal.refresh_proactive_digest_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','aria_internal','public'
as $$
declare
  h jsonb;
  r jsonb;
  s jsonb;
  d jsonb;
  recs jsonb;
  fp text;
  did text;
  observed timestamptz;
begin
  select aria_internal.get_operational_health_v1() into h;
  select aria_internal.router_live_snapshot() into r;
  observed := coalesce((h->>'generated_at')::timestamptz, now());

  recs := case when h->>'status' = 'degraded' then
    jsonb_build_array(jsonb_build_object(
      'id','proactive_health_attention_v1',
      'version','aria-proactive-intelligence-v1.0.0',
      'action_mode','recommendation_only',
      'kind','diagnostic_attention',
      'priority','high',
      'title','Existe un diagnostico operativo sin resolver',
      'reason','La salud operacional de ARIA esta marcada como degraded.',
      'next_action','Revisar la causa raiz y la evidencia asociada antes de realizar acciones correctivas.',
      'source_refs',jsonb_build_array('operational-health-v1','aria_internal.get_operational_health_v1')
    ))
  else '[]'::jsonb end;

  s := jsonb_build_object(
    'observed_at',observed,
    'source_refs',jsonb_build_array('aria_internal.get_operational_health_v1','aria_internal.router_live_snapshot'),
    'health',h,
    'router',r
  );

  d := jsonb_build_object(
    'version','aria-proactive-intelligence-v1.0.0',
    'action_mode','recommendation_only',
    'generated_at',observed,
    'status',case when jsonb_array_length(recs) > 0 then 'attention' else 'quiet' end,
    'recommendation_count',jsonb_array_length(recs),
    'urgent_count',0,
    'high_count',case when jsonb_array_length(recs) > 0 then 1 else 0 end,
    'normal_count',0,
    'low_count',0,
    'recommendations',recs
  );

  fp := md5(jsonb_build_object('engine_version','aria-proactive-intelligence-v1.0.0','snapshot',s)::text);
  did := 'proactive_live_' || fp;

  insert into aria_internal.proactive_digests(
    digest_id,engine_version,action_mode,observed_at,fingerprint,snapshot,digest,source_refs
  )
  values(did,'aria-proactive-intelligence-v1.0.0','recommendation_only',observed,fp,s,d,s->'source_refs')
  on conflict (digest_id) do nothing;

  return jsonb_build_object(
    'ok',true,'live',true,'persisted',true,
    'engine_version','aria-proactive-intelligence-v1.0.0',
    'action_mode','recommendation_only',
    'digest_id',did,'fingerprint',fp,'observed_at',observed,
    'recommendation_count',jsonb_array_length(recs),
    'recommendations',recs,'sources',s->'source_refs',
    'live_health_status',h->>'status',
    'router_candidate_count',jsonb_array_length(coalesce(r->'candidates','[]'::jsonb))
  );
end;
$$;

revoke execute on function aria_internal.refresh_proactive_digest_v1() from public, anon, authenticated;
grant execute on function aria_internal.refresh_proactive_digest_v1() to service_role;
