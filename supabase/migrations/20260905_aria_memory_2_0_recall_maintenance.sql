create or replace function aria_memory.search_hybrid(
  p_query text,
  p_query_embedding extensions.vector(384) default null,
  p_limit integer default 12,
  p_lexical_weight numeric default 0.55,
  p_semantic_weight numeric default 0.45,
  p_rrf_k integer default 50
)
returns table(
  memory_id uuid,
  memory_type text,
  title text,
  content text,
  confidence numeric,
  importance numeric,
  salience numeric,
  lexical_rank bigint,
  semantic_rank bigint,
  hybrid_score numeric
)
language sql
stable
security definer
set search_path = pg_catalog, aria_memory, extensions
as $$
with lexical as (
  select m.memory_id,
         row_number() over(order by ts_rank_cd(m.search_tsv, websearch_to_tsquery('simple', p_query)) desc, m.importance desc, m.confidence desc) as rank_ix
  from aria_memory.memory_items m
  where m.status = 'active'
    and m.search_tsv @@ websearch_to_tsquery('simple', p_query)
  limit greatest(1, least(p_limit * 3, 100))
),
semantic as (
  select m.memory_id,
         row_number() over(order by m.embedding <=> p_query_embedding asc, m.importance desc, m.confidence desc) as rank_ix
  from aria_memory.memory_items m
  where p_query_embedding is not null
    and m.status = 'active'
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding asc
  limit greatest(1, least(p_limit * 3, 100))
),
all_hits as (
  select coalesce(l.memory_id, s.memory_id) as memory_id,
         l.rank_ix as lexical_rank,
         s.rank_ix as semantic_rank
  from lexical l
  full outer join semantic s using (memory_id)
)
select m.memory_id,m.memory_type,m.title,m.content,m.confidence,m.importance,m.salience,h.lexical_rank,h.semantic_rank,
       (coalesce(p_lexical_weight * (1.0 / (p_rrf_k + h.lexical_rank)), 0)
        + coalesce(p_semantic_weight * (1.0 / (p_rrf_k + h.semantic_rank)), 0))
       * (0.50 + 0.25 * m.confidence + 0.15 * m.importance + 0.10 * m.salience) as hybrid_score
from all_hits h
join aria_memory.memory_items m on m.memory_id = h.memory_id
where m.status = 'active'
order by hybrid_score desc, m.updated_at desc
limit greatest(1, least(p_limit, 100));
$$;

create or replace function aria_memory.decay_memory(p_half_life_days numeric default 30,p_min_score numeric default 0.10)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, aria_memory
as $$
declare v_count integer;
begin
  update aria_memory.memory_items
  set salience = greatest(p_min_score, least(1.0, salience * power(0.5, greatest(0, extract(epoch from (now() - coalesce(last_accessed_at, created_at))) / 86400.0) / nullif(p_half_life_days,0)))),
      updated_at = now()
  where status = 'active' and salience > p_min_score;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function aria_memory.consolidate_duplicates(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, aria_memory
as $$
declare v_count integer := 0; r record;
begin
  for r in
    select a.memory_id,b.memory_id as keep_id
    from aria_memory.memory_items a
    join aria_memory.memory_items b on a.content_hash=b.content_hash and a.memory_id<>b.memory_id and a.created_at>b.created_at
    where a.status='active' and b.status='active'
    order by a.created_at limit greatest(1,least(p_limit,1000))
  loop
    update aria_memory.memory_items set status='superseded',supersedes_memory_id=r.keep_id,updated_at=now()
    where memory_id=r.memory_id and status='active';
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function aria_memory.run_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, aria_memory
as $$
declare v_consolidated integer := 0; v_decayed integer := 0;
begin
  v_consolidated := aria_memory.consolidate_duplicates(250);
  v_decayed := aria_memory.decay_memory(30,0.10);
  return jsonb_build_object('consolidated',v_consolidated,'decayed',v_decayed,'ran_at',now());
end;
$$;

create or replace function aria_memory.touch_access(p_memory_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, aria_memory
as $$
  update aria_memory.memory_items
  set access_count=access_count+1,last_accessed_at=now(),salience=least(1.0,greatest(0.0,salience+0.02)),updated_at=now()
  where memory_id=p_memory_id and status='active';
$$;

create or replace function aria_memory.remember_with_embedding(
  p_memory_type text,p_title text,p_content text,p_content_hash text,
  p_source_type text default 'aria',p_source_ref text default null,
  p_provenance jsonb default '{}',p_metadata jsonb default '{}',
  p_confidence numeric default .5,p_importance numeric default .5,
  p_salience numeric default .5,p_embedding_text text default null
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, aria_memory, extensions
as $$
declare v_id uuid;
begin
  insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience,embedding)
  values(p_memory_type,coalesce(p_title,'Untitled'),p_content,p_content_hash,p_source_type,p_source_ref,coalesce(p_provenance,'{}'),coalesce(p_metadata,'{}'),p_confidence,p_importance,p_salience,case when p_embedding_text is null then null else p_embedding_text::extensions.vector end)
  on conflict(content_hash) do update set updated_at=now()
  returning memory_id into v_id;
  insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload)
  values(v_id,'remembered',p_source_ref,jsonb_build_object('memory_type',p_memory_type,'embedded',p_embedding_text is not null));
  return v_id;
end;
$$;

create or replace function aria_memory.search_hybrid_text(
  p_query text,p_query_embedding_text text default null,p_limit integer default 12,
  p_lexical_weight numeric default .55,p_semantic_weight numeric default .45,p_rrf_k integer default 50
)
returns table(memory_id uuid,memory_type text,title text,content text,confidence numeric,importance numeric,salience numeric,hybrid_score numeric)
language sql stable security definer
set search_path = pg_catalog, aria_memory, extensions
as $$
select memory_id,memory_type,title,content,confidence,importance,salience,hybrid_score
from aria_memory.search_hybrid(p_query,case when p_query_embedding_text is null then null else p_query_embedding_text::extensions.vector end,p_limit,p_lexical_weight,p_semantic_weight,p_rrf_k);
$$;

create or replace function aria_memory.refresh_memory_metadata()
returns trigger language plpgsql security definer set search_path=pg_catalog,aria_memory
as $$ begin new.updated_at:=now(); return new; end; $$;

drop trigger if exists memory_items_refresh_metadata on aria_memory.memory_items;
create trigger memory_items_refresh_metadata before insert or update of title,subject,content on aria_memory.memory_items for each row execute function aria_memory.refresh_memory_metadata();

revoke all on function aria_memory.search_hybrid(text,extensions.vector,integer,numeric,numeric,integer) from public,anon,authenticated;
revoke all on function aria_memory.decay_memory(numeric,numeric) from public,anon,authenticated;
revoke all on function aria_memory.consolidate_duplicates(integer) from public,anon,authenticated;
revoke all on function aria_memory.run_maintenance() from public,anon,authenticated;
revoke all on function aria_memory.touch_access(uuid) from public,anon,authenticated;
revoke all on function aria_memory.remember_with_embedding(text,text,text,text,text,text,jsonb,jsonb,numeric,numeric,numeric,text) from public,anon,authenticated;
revoke all on function aria_memory.search_hybrid_text(text,text,integer,numeric,numeric,integer) from public,anon,authenticated;
grant execute on function aria_memory.search_hybrid(text,extensions.vector,integer,numeric,numeric,integer) to service_role;
grant execute on function aria_memory.decay_memory(numeric,numeric) to service_role;
grant execute on function aria_memory.consolidate_duplicates(integer) to service_role;
grant execute on function aria_memory.run_maintenance() to service_role;
grant execute on function aria_memory.touch_access(uuid) to service_role;
grant execute on function aria_memory.remember_with_embedding(text,text,text,text,text,text,jsonb,jsonb,numeric,numeric,numeric,text) to service_role;
grant execute on function aria_memory.search_hybrid_text(text,text,integer,numeric,numeric,integer) to service_role;

select cron.unschedule('aria-memory-maintenance-daily') where exists (select 1 from cron.job where jobname='aria-memory-maintenance-daily');
select cron.schedule('aria-memory-maintenance-daily','17 3 * * *',$$select aria_memory.run_maintenance();$$);