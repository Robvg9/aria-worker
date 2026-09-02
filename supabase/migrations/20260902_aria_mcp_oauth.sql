-- ARIA Mission 9.5 — OAuth 2.1 / PKCE persistence
-- Service-role only tables. No plaintext OAuth access tokens are stored.
create extension if not exists pgcrypto;

create table if not exists public.aria_mcp_oauth_clients (
  client_id text primary key,
  client_name text not null,
  redirect_uris jsonb not null check (jsonb_typeof(redirect_uris) = 'array' and jsonb_array_length(redirect_uris) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.aria_mcp_oauth_pending (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.aria_mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  state text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  email text,
  trace_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.aria_mcp_oauth_codes (
  code text primary key,
  client_id text not null references public.aria_mcp_oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256' check (code_challenge_method = 'S256'),
  user_id uuid not null,
  encrypted_access_token text not null,
  scope text not null default 'openid profile email',
  trace_id text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

alter table public.aria_mcp_oauth_pending add column if not exists trace_id text;
alter table public.aria_mcp_oauth_codes add column if not exists trace_id text;

create index if not exists aria_mcp_oauth_pending_expiry_idx
  on public.aria_mcp_oauth_pending (expires_at);
create index if not exists aria_mcp_oauth_codes_expiry_idx
  on public.aria_mcp_oauth_codes (expires_at);
create index if not exists aria_mcp_oauth_pending_trace_idx
  on public.aria_mcp_oauth_pending (trace_id);
create index if not exists aria_mcp_oauth_codes_trace_idx
  on public.aria_mcp_oauth_codes (trace_id);

alter table public.aria_mcp_oauth_clients enable row level security;
alter table public.aria_mcp_oauth_pending enable row level security;
alter table public.aria_mcp_oauth_codes enable row level security;

revoke all on public.aria_mcp_oauth_clients from anon, authenticated;
revoke all on public.aria_mcp_oauth_pending from anon, authenticated;
revoke all on public.aria_mcp_oauth_codes from anon, authenticated;

grant all on public.aria_mcp_oauth_clients to service_role;
grant all on public.aria_mcp_oauth_pending to service_role;
grant all on public.aria_mcp_oauth_codes to service_role;

comment on table public.aria_mcp_oauth_clients is 'ARIA 9.5 MCP OAuth clients; service_role only.';
comment on table public.aria_mcp_oauth_pending is 'Short-lived OAuth browser authorization state; service_role only.';
comment on table public.aria_mcp_oauth_codes is 'Short-lived one-time PKCE authorization codes. Access token is encrypted at rest; service_role only.';
