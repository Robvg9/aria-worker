create or replace function aria_memory.set_embedding(p_memory_id uuid,p_embedding_text text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, aria_memory, extensions
as $$
begin
  update aria_memory.memory_items
  set embedding = case when p_embedding_text is null then null else p_embedding_text::extensions.vector end,
      updated_at = now()
  where memory_id = p_memory_id and status = 'active';
  return found;
end;
$$;

revoke all on function aria_memory.set_embedding(uuid,text) from public,anon,authenticated;
grant execute on function aria_memory.set_embedding(uuid,text) to service_role;

select cron.unschedule('aria-memory-semantic-backfill') where exists (select 1 from cron.job where jobname='aria-memory-semantic-backfill');
select cron.schedule(
  'aria-memory-semantic-backfill',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-memory-v2',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='aria_autonomy_cron_token')
      ),
      body := '{"action":"embed_missing","limit":10}'::jsonb
    );
  $$
);