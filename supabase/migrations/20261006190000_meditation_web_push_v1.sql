-- ARIA Meditation IA: real background Web Push delivery.
-- Secret values live in Supabase Vault and are never committed here.
-- Production provisioning is validated below.

create table if not exists aria_internal.meditation_push_subscriptions (
  subscription_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  expiration_time bigint,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meditation_push_subscriptions_user_endpoint_key unique (user_id, endpoint)
);

create index if not exists meditation_push_subscriptions_user_id_idx
  on aria_internal.meditation_push_subscriptions(user_id);
create index if not exists meditation_push_subscriptions_active_idx
  on aria_internal.meditation_push_subscriptions(user_id, active);

alter table aria_internal.meditation_push_subscriptions enable row level security;
revoke all on aria_internal.meditation_push_subscriptions from anon, authenticated, public;
grant select, insert, update, delete on aria_internal.meditation_push_subscriptions to service_role;

create table if not exists aria_internal.meditation_push_deliveries (
  notification_id uuid not null references aria_internal.meditation_notifications(notification_id) on delete cascade,
  subscription_id uuid not null references aria_internal.meditation_push_subscriptions(subscription_id) on delete cascade,
  status text not null default 'pending',
  http_status integer,
  attempts integer not null default 0,
  error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (notification_id, subscription_id)
);

create index if not exists meditation_push_deliveries_notification_idx
  on aria_internal.meditation_push_deliveries(notification_id);

revoke all on aria_internal.meditation_push_deliveries from anon, authenticated, public;
grant select, insert, update, delete on aria_internal.meditation_push_deliveries to service_role;

create or replace function public.aria_get_web_push_runtime_config()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object(
    'vapid_public', (select decrypted_secret from vault.decrypted_secrets where name='aria_webpush_vapid_public_v1'),
    'vapid_private', (select decrypted_secret from vault.decrypted_secrets where name='aria_webpush_vapid_private_v1'),
    'webhook_secret', (select decrypted_secret from vault.decrypted_secrets where name='aria_webpush_webhook_secret_v1')
  );
end;
$$;
revoke all on function public.aria_get_web_push_runtime_config() from public, anon, authenticated;
grant execute on function public.aria_get_web_push_runtime_config() to service_role;

create or replace function aria_internal.set_meditation_push_subscription_updated_at()
returns trigger
language plpgsql
set search_path = 'pg_catalog','aria_internal'
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists meditation_push_subscriptions_updated_at on aria_internal.meditation_push_subscriptions;
create trigger meditation_push_subscriptions_updated_at
before update on aria_internal.meditation_push_subscriptions
for each row execute function aria_internal.set_meditation_push_subscription_updated_at();
revoke all on function aria_internal.set_meditation_push_subscription_updated_at() from public, anon, authenticated;
grant execute on function aria_internal.set_meditation_push_subscription_updated_at() to service_role;

create or replace function aria_internal.dispatch_meditation_web_push()
returns trigger
language plpgsql
security definer
set search_path = 'pg_catalog','aria_internal'
as $$
declare
  v_secret text;
  v_url constant text := 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-meditation-web-push-v1';
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name='aria_webpush_webhook_secret_v1';

  if v_secret is null or length(v_secret) < 24 then
    raise warning 'ARIA Web Push secret is not provisioned';
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'content-type','application/json',
      'x-aria-webpush-secret',v_secret
    ),
    body := jsonb_build_object(
      'notification', jsonb_build_object(
        'notification_id', new.notification_id,
        'source_event_id', new.source_event_id,
        'mission_id', new.mission_id,
        'kind', new.kind,
        'severity', new.severity,
        'title', new.title,
        'message', new.message,
        'action', new.action,
        'metadata', new.metadata,
        'created_at', new.created_at
      )
    )
  );

  return new;
exception when others then
  raise warning 'ARIA Web Push enqueue failed: %', sqlerrm;
  return new;
end;
$$;
revoke all on function aria_internal.dispatch_meditation_web_push() from public, anon, authenticated;
grant execute on function aria_internal.dispatch_meditation_web_push() to service_role;

drop trigger if exists trg_meditation_notifications_web_push on aria_internal.meditation_notifications;
create trigger trg_meditation_notifications_web_push
after insert on aria_internal.meditation_notifications
for each row execute function aria_internal.dispatch_meditation_web_push();

do $$
begin
  if not exists (select 1 from vault.secrets where name='aria_webpush_vapid_public_v1')
     or not exists (select 1 from vault.secrets where name='aria_webpush_vapid_private_v1')
     or not exists (select 1 from vault.secrets where name='aria_webpush_webhook_secret_v1') then
    raise exception 'aria_webpush_vault_secrets_missing';
  end if;
end $$;
