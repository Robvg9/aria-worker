create table if not exists aria_internal.execution_approvals (
  authorization_id text primary key,
  request_id text not null,
  execution_id text not null,
  tool_id text not null,
  operation text not null,
  risk_class text not null check (risk_class in ('READ','LOW_RISK_WRITE','HIGH_RISK_WRITE','DESTRUCTIVE')),
  target jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired','revoked')),
  approved_by text,
  approved_at timestamptz,
  expires_at timestamptz,
  verification_ref text,
  policy_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists execution_approvals_execution_idx
  on aria_internal.execution_approvals (execution_id);

create index if not exists execution_approvals_status_idx
  on aria_internal.execution_approvals (status);

alter table aria_internal.execution_approvals enable row level security;

revoke all on table aria_internal.execution_approvals from public;
revoke all on table aria_internal.execution_approvals from anon;
revoke all on table aria_internal.execution_approvals from authenticated;
grant select, insert, update, delete on table aria_internal.execution_approvals to service_role;

comment on table aria_internal.execution_approvals is
  'ARIA Block A durable human approval store. Authorization records only; no secrets; not a tool executor.';

comment on column aria_internal.execution_approvals.verification_ref is
  'Reference to an external verification result. Never plaintext password, OTP, token, or secret material.';
