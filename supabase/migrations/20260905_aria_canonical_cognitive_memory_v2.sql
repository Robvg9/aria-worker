create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create schema if not exists aria_memory;

create table if not exists aria_memory.memory_items (
  memory_id uuid primary key default gen_random_uuid(),
  memory_type text not null check (memory_type in ('episodic','semantic','procedural','fact','decision','lesson','preference','skill','hypothesis')),
  subject text,
  title text not null,
  content text not null,
  normalized_content text generated always as (lower(regexp_replace(trim(content),'\s+',' ','g'))) stored,
  content_hash text not null unique,
  status text not null default 'active' check (status in ('active','superseded','retracted','archived','candidate')),
  confidence numeric(5,4) not null default .5 check (confidence between 0 and 1),
  importance numeric(5,4) not null default .5 check (importance between 0 and 1),
  salience numeric(5,4) not null default .5 check (salience between 0 and 1),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  source_type text not null default 'aria' check (source_type in ('aria','chatbending','mission','tool','human','provider','documentation','system')),
  source_ref text,
  provenance jsonb not null default '{}',
  metadata jsonb not null default '{}',
  embedding extensions.vector(384),
  search_tsv tsvector generated always as (to_tsvector('simple',coalesce(title,'')||' '||coalesce(subject,'')||' '||content)) stored,
  access_count bigint not null default 0,
  last_accessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  supersedes_memory_id uuid references aria_memory.memory_items(memory_id),
  constraint memory_valid_window check (valid_until is null or valid_until > valid_from)
);

create table if not exists aria_memory.memory_relations (
  relation_id uuid primary key default gen_random_uuid(),
  from_memory_id uuid not null references aria_memory.memory_items(memory_id) on delete cascade,
  to_memory_id uuid not null references aria_memory.memory_items(memory_id) on delete cascade,
  relation_type text not null check (relation_type in ('supports','contradicts','refines','supersedes','derived_from','related_to','part_of','caused_by','learned_from','implements')),
  strength numeric(5,4) not null default .5 check (strength between 0 and 1),
  provenance jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique(from_memory_id,to_memory_id,relation_type)
);

create table if not exists aria_memory.memory_events (
  event_id bigint generated always as identity primary key,
  memory_id uuid references aria_memory.memory_items(memory_id) on delete cascade,
  event_type text not null,
  source_ref text,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists memory_items_search_idx on aria_memory.memory_items using gin(search_tsv);
create index if not exists memory_items_type_status_idx on aria_memory.memory_items(memory_type,status);
create index if not exists memory_items_source_idx on aria_memory.memory_items(source_type,source_ref);
create index if not exists memory_items_embedding_hnsw_idx on aria_memory.memory_items using hnsw (embedding vector_cosine_ops) where embedding is not null;
create index if not exists memory_relations_from_idx on aria_memory.memory_relations(from_memory_id);
create index if not exists memory_relations_to_idx on aria_memory.memory_relations(to_memory_id);
create index if not exists memory_events_memory_idx on aria_memory.memory_events(memory_id,created_at desc);

alter table aria_memory.memory_items enable row level security;
alter table aria_memory.memory_relations enable row level security;
alter table aria_memory.memory_events enable row level security;
revoke all on schema aria_memory from anon,authenticated;
revoke all on all tables in schema aria_memory from anon,authenticated;
revoke all on all functions in schema aria_memory from anon,authenticated;
grant usage on schema aria_memory to service_role;
grant select,insert,update,delete on all tables in schema aria_memory to service_role;

create or replace function aria_memory.remember(p_memory_type text,p_title text,p_content text,p_content_hash text,p_source_type text default 'aria',p_source_ref text default null,p_provenance jsonb default '{}',p_metadata jsonb default '{}',p_confidence numeric default .5,p_importance numeric default .5,p_salience numeric default .5) returns uuid language plpgsql security definer set search_path='' as $$ declare v_id uuid; begin insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience) values(p_memory_type,coalesce(p_title,'Untitled'),p_content,p_content_hash,p_source_type,p_source_ref,coalesce(p_provenance,'{}'),coalesce(p_metadata,'{}'),p_confidence,p_importance,p_salience) on conflict(content_hash) do update set updated_at=now() returning memory_id into v_id; insert into aria_memory.memory_events(memory_id,event_type,source_ref,payload) values(v_id,'created',p_source_ref,jsonb_build_object('memory_type',p_memory_type)); return v_id; end; $$;
create or replace function aria_memory.record_access(p_memory_id uuid) returns void language sql security definer set search_path='' as $$ update aria_memory.memory_items set access_count=access_count+1,last_accessed_at=now(),updated_at=now() where memory_id=p_memory_id; insert into aria_memory.memory_events(memory_id,event_type) values(p_memory_id,'accessed'); $$;
create or replace function aria_memory.search_lexical(p_query text,p_limit int default 10) returns table(memory_id uuid,memory_type text,title text,content text,confidence numeric,importance numeric,salience numeric,rank real) language sql security definer set search_path='' as $$ select m.memory_id,m.memory_type,m.title,m.content,m.confidence,m.importance,m.salience,ts_rank(m.search_tsv,websearch_to_tsquery('simple',p_query)) from aria_memory.memory_items m where m.status='active' and m.search_tsv @@ websearch_to_tsquery('simple',p_query) order by 8 desc,m.confidence desc,m.importance desc limit greatest(1,least(coalesce(p_limit,10),50)); $$;
grant execute on function aria_memory.remember(text,text,text,text,text,text,jsonb,jsonb,numeric,numeric,numeric) to service_role;
grant execute on function aria_memory.record_access(uuid) to service_role;
grant execute on function aria_memory.search_lexical(text,int) to service_role;

create or replace function public.aria_memory_remember(p_memory_type text,p_title text,p_content text,p_content_hash text,p_source_type text default 'aria',p_source_ref text default null,p_provenance jsonb default '{}',p_metadata jsonb default '{}',p_confidence numeric default .5,p_importance numeric default .5,p_salience numeric default .5) returns uuid language sql security definer set search_path='' as $$ select aria_memory.remember(p_memory_type,p_title,p_content,p_content_hash,p_source_type,p_source_ref,p_provenance,p_metadata,p_confidence,p_importance,p_salience); $$;
create or replace function public.aria_memory_record_access(p_memory_id uuid) returns void language sql security definer set search_path='' as $$ select aria_memory.record_access(p_memory_id); $$;
create or replace function public.aria_memory_search_lexical(p_query text,p_limit int default 10) returns table(memory_id uuid,memory_type text,title text,content text,confidence numeric,importance numeric,salience numeric,rank real) language sql security definer set search_path='' as $$ select * from aria_memory.search_lexical(p_query,p_limit); $$;
revoke all on function public.aria_memory_remember(text,text,text,text,text,text,jsonb,jsonb,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.aria_memory_record_access(uuid) from public,anon,authenticated;
revoke all on function public.aria_memory_search_lexical(text,int) from public,anon,authenticated;
grant execute on function public.aria_memory_remember(text,text,text,text,text,text,jsonb,jsonb,numeric,numeric,numeric) to service_role;
grant execute on function public.aria_memory_record_access(uuid) to service_role;
grant execute on function public.aria_memory_search_lexical(text,int) to service_role;

insert into aria_memory.memory_items(memory_type,title,content,content_hash,source_type,source_ref,provenance,metadata,confidence,importance,salience)
select case when al.category ilike '%lesson%' then 'lesson' else 'semantic' end,'Legacy autonomy learning',al.summary,encode(digest(coalesce(al.summary,''),'sha256'),'hex'),'mission',al.mission_id,jsonb_build_object('legacy_table','aria_internal.autonomy_learnings','lesson_id',al.lesson_id),al.evidence,least(greatest(al.confidence,0),1),case when al.reusable then .8 else .5 end,.7 from aria_internal.autonomy_learnings al on conflict(content_hash) do nothing;