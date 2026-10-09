-- Persist the requested OAuth scopes during ARIA MCP authorization.
-- Existing pending authorizations retain the least-privilege base scope.
BEGIN;
ALTER TABLE public.aria_mcp_oauth_pending
  ADD COLUMN IF NOT EXISTS scope text;
UPDATE public.aria_mcp_oauth_pending
  SET scope = 'aria.mcp.inbound'
  WHERE scope IS NULL OR btrim(scope) = '';
ALTER TABLE public.aria_mcp_oauth_pending
  ALTER COLUMN scope SET DEFAULT 'aria.mcp.inbound';
ALTER TABLE public.aria_mcp_oauth_pending
  ALTER COLUMN scope SET NOT NULL;
COMMENT ON COLUMN public.aria_mcp_oauth_pending.scope IS
  'OAuth scopes requested/granted for this pending authorization; elevated CuevaCoin scope requires explicit consent.';
COMMIT;
