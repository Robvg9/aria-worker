-- ARIA MCP OAuth — refresh tokens + rotation support
-- Service-role only. Complements 20260902_aria_mcp_oauth.sql

create table if not exists public.aria_mcp_oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  client_id text not null references public.aria_mcp_oauth_clients(client_id) on delete cascade,
  scope text not null default 'aria.mcp.inbound',
  resource text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_from uuid references public.aria_mcp_oauth_refresh_tokens(id)
);

create index if not exists aria_mcp_oauth_refresh_hash_idx
  on public.aria_mcp_oauth_refresh_tokens (token_hash);
create index if not exists aria_mcp_oauth_refresh_expiry_idx
  on public.aria_mcp_oauth_refresh_tokens (expires_at);

-- Allow opaque and HTTPS client_ids (CIMD). redirect_uris remain exact-match.
alter table public.aria_mcp_oauth_clients
  add column if not exists token_endpoint_auth_method text not null default 'none';
alter table public.aria_mcp_oauth_clients
  add column if not exists client_uri text;
alter table public.aria_mcp_oauth_clients
  add column if not exists metadata_source text not null default 'dcr'
  check (metadata_source in ('dcr', 'cimd', 'static'));

-- Codes: make user_id optional (connector tokens are not user JWTs)
alter table public.aria_mcp_oauth_codes
  alter column user_id drop not null;
alter table public.aria_mcp_oauth_codes
  alter column encrypted_access_token drop not null;
alter table public.aria_mcp_oauth_codes
  add column if not exists resource text;
alter table public.aria_mcp_oauth_codes
  add column if not exists scope text;

alter table public.aria_mcp_oauth_refresh_tokens enable row level security;
revoke all on public.aria_mcp_oauth_refresh_tokens from anon, authenticated;
grant all on public.aria_mcp_oauth_refresh_tokens to service_role;

comment on table public.aria_mcp_oauth_refresh_tokens is
  'ARIA MCP OAuth refresh tokens (hashed). Rotation-aware. service_role only.';
