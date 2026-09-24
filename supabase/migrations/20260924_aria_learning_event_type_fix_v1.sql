-- Fix failure-learning event types to respect aria_memory.memory_events constraints.
create or replace function aria_internal.capture_failure_mastery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, aria_internal, aria_memory, extensions
as $$
declare
  v_detail text;
  v_goal text;
  v_signature text;
  v_terms jsonb := '[]'::jsonb;
  v_content text;
  v_hash text;
  v_id uuid;
  v_procedure jsonb;
  v_previous_id uuid;
  v_previous_status text;
  v_occurrence integer := 0;
  v_state text := 'incident';
  v_recurred_after_promotion boolean := false;
begin
  if new.status <> 'failed' or (tg_op='UPDATE' and old.status='failed') then
    return new;
  end if;

  v_goal := trim(coalesce(new.goal,''));
  v_detail := lower(left(coalesce(new.last_stderr,'') || ' ' || coalesce(new.next_action,'') || ' ' || coalesce(new.checkpoint->'recovery'->>'failure_reason',''),3000));
  v_signature := encode(extensions.digest(
    lower(v_goal) || '|' ||
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(v_detail,'mission[_-][0-9a-f-]+','<mission>','gi'),
          '[0-9a-f]{8}-[0-9a-f-]{20,}','<uuid>','gi'
        ),
        '[0-9]+','<n>','g'
      ),
      '\\s+',' ','g'
    ) || '|' ||
    regexp_replace(coalesce(new.checkpoint->'recovery'->>'failure_reason',''), '[0-9]+','<n>','g'),
    'sha256'
  ),'hex');

  if position('deno.json' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('deno.json'); end if;
  if position('import_map' in v_detail)>0 or position('import-map' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('import_map'); end if;
  if position('wrangler.toml' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('wrangler.toml'); end if;
  if position('migration' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('migration'); end if;
  if position('rls' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('rls'); end if;
  if position('branch' in v_detail) > 0 or position('pull request' in v_detail)>0 then v_terms := v_terms || jsonb_build_array('branch'); end if;
  if jsonb_array_length(v_terms)=0 then v_terms := jsonb_build_array('verify'); end if;

  v_procedure := jsonb_build_array(
    'Recuperar el fallo previo y su evidencia antes de elegir una estrategia.',
    'No repetir la estrategia fallida salvo que exista evidencia nueva y explícita que la justifique.',
    'Verificar los prerrequisitos asociados al fallo antes de ejecutar la acción.',
    'Ejecutar una verificación real del resultado y persistir la evidencia.'
  );

  select m.memory_id,m.status,
         greatest(1,coalesce((m.metadata->>'occurrence_count')::integer,1))
    into v_previous_id,v_previous_status,v_occurrence
  from aria_memory.memory_items m
  where coalesce(m.metadata->>'learning_kind','')='failure_prevention'
    and m.metadata->>'failure_signature'=v_signature
    and m.memory_type='skill'
  order by case when m.status='active' then 0 else 1 end, m.updated_at desc
  limit 1;

  if v_previous_id is null then
    v_occurrence := 1;
  else
    v_occurrence := v_occurrence + 1;
    v_recurred_after_promotion := v_previous_status='active';
  end if;

  v_state := case
    when v_recurred_after_promotion then 'root_cause_required'
    when v_occurrence >= 5 then 'root_cause_required'
    when v_occurrence >= 4 then 'pattern_confirmed'
    when v_occurrence >= 3 then 'pattern_candidate'
    when v_occurrence >= 2 then 'recurrent'
    else 'incident'
  end;

  if v_state='root_cause_required' then
    v_terms := v_terms || jsonb_build_array('root_cause','verify');
  end if;

  if v_previous_id is not null then
    update aria_memory.memory_items
    set
      updated_at=now(),
      metadata = metadata
        || jsonb_build_object(
          'occurrence_count',v_occurrence,
          'pattern_state',v_state,
          'recurrence_after_promotion',v_recurred_after_promotion,
          'last_seen_mission',new.mission_id,
          'last_seen_at',clock_timestamp()
        ),
      confidence = greatest(confidence,case when v_state='root_cause_required' then .94 else .88 end)
    where memory_id=v_previous_id;

    insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
    values(
      v_previous_id,
      'updated',
      new.mission_id,
      jsonb_build_object(
        'occurrence_count',v_occurrence,
        'pattern_state',v_state,
        'recurrence_after_promotion',v_recurred_after_promotion
      )
    );
  end if;

  v_content := 'Failure-prevention candidate. Goal='||v_goal||
    '. Failure detail='||left(v_detail,1800)||
    '. Prevention procedure='||v_procedure::text;

  v_hash := encode(extensions.digest('failure-prevention|'||v_signature,'sha256'),'hex');

  insert into aria_memory.memory_items(
    memory_type,title,content,content_hash,status,confidence,importance,salience,
    source_type,source_ref,provenance,metadata
  )
  values(
    'skill',
    'Failure prevention candidate: '||left(v_goal,160),
    v_content,
    v_hash,
    'candidate',
    .88,.90,.95,
    'mission',
    new.mission_id,
    jsonb_build_object('engine','failure-mastery-v1','mission_id',new.mission_id,'failure_signature',v_signature),
    jsonb_build_object(
      'learning_kind','failure_prevention',
      'activation_status',case when v_previous_id is null then 'candidate' else coalesce((select metadata->>'activation_status' from aria_memory.memory_items where memory_id=v_previous_id),'candidate') end,
      'source_mission_id',new.mission_id,
      'failure_signature',v_signature,
      'scope',v_goal,
      'procedure',v_procedure,
      'preflight_required',case when v_previous_status='active' then true else false end,
      'preflight_requirements',jsonb_build_object('mode','contains_all','terms',v_terms),
      'occurrence_count',v_occurrence,
      'pattern_state',v_state,
      'recurrence_after_promotion',v_recurred_after_promotion
    )
  )
  on conflict(content_hash) do update
    set content=excluded.content, updated_at=now(), metadata=excluded.metadata, confidence=greatest(aria_memory.memory_items.confidence,excluded.confidence)
  returning memory_id into v_id;

  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
  values(
    v_id,'created',new.mission_id,
    jsonb_build_object('failure_signature',v_signature,'terms',v_terms,'procedure',v_procedure,'occurrence_count',v_occurrence,'pattern_state',v_state,'recurrence_after_promotion',v_recurred_after_promotion)
  );

  return new;
end;
$$;


revoke all on function aria_internal.capture_failure_mastery() from public,anon,authenticated;
grant execute on function aria_internal.capture_failure_mastery() to service_role;
