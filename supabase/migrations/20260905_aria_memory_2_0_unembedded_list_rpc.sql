create or replace function aria_memory.list_unembedded(p_limit integer default 10)
returns table(memory_id uuid,title text,content text)
language sql
stable
security definer
set search_path = pg_catalog, aria_memory
as $$
  select m.memory_id,m.title,m.content
  from aria_memory.memory_items m
  where m.embedding is null and m.status='active'
  order by m.created_at asc
  limit greatest(1,least(coalesce(p_limit,10),20));
$$;

revoke all on function aria_memory.list_unembedded(integer) from public,anon,authenticated;
grant execute on function aria_memory.list_unembedded(integer) to service_role;
