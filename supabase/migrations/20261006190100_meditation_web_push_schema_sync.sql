-- Production already applied the base Web Push migration before repository promotion.
-- Keep this idempotent so CI can reconcile the existing schema safely.
alter table aria_internal.meditation_push_subscriptions
  add column if not exists active boolean not null default true;
create index if not exists meditation_push_subscriptions_active_idx
  on aria_internal.meditation_push_subscriptions(user_id, active);
