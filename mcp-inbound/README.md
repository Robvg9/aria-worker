# ARIA MCP Inbound (Grok Free \u2192 ARIA)

Direction: **Grok \u2192 ARIA only**. Does not call the xAI paid API.

## Why the previous Grok connector lost tools

Concrete causes in this repo, not "Grok is unstable":

1. **OAuth token \u2260 durable connector credential.** `aria-mcp-oauth-grok-v3` returns the Supabase user JWT (`expires_in: 3600`). After expiry Grok later `tools/list` / `tools/call` hit 401 and the catalog vanishes.
2. **CIMD client_id rejected.** `clientFromRequest` returns null for `https://` client IDs. Grok Custom Connector often presents a URL client_id after DCR/CIMD.
3. **Resource identity split.** MCP resource advertised as `https://aria.robvg9.workers.dev/mcp` while functions lived under supabase.co. RFC 8707 resource mismatches drop the session.
4. **Catalog too large and dynamic.** `aria-mcp-server-grok-v4` exposes 10 tools including EAS. Discovery timeout or mid-list 401 looks like partial tools then gone.
5. **Auth required on every JSON-RPC method with a rotating JWT.** Streamable HTTP is stateless; Grok retries without a fresh token.

## Auth chosen for Grok Web Custom Connector

**Governed static Bearer** (`Authorization: Bearer <ARIA_MCP_INBOUND_TOKEN>`).

Official xAI Remote MCP documents an `authorization` field sent as the Authorization header on every MCP request. Grok Build custom MCP uses the same header pattern.

Not used in phase 1: OAuth 2.1 + PKCE (kept intact, unused by this path).

## Grok setup

1. Deploy `aria-mcp-inbound-grok-v1` and set secret `ARIA_MCP_INBOUND_TOKEN`.
2. grok.com \u2192 Connectors \u2192 Custom MCP.
3. URL: `https://<project>.supabase.co/functions/v1/aria-mcp-inbound-grok-v1`
4. Auth header: `Authorization: Bearer <token>`
5. Ask Grok to call `aria_status` then `aria_context`.

Phase 1 tools only: `aria_status`, `aria_context`.
`aria_memory_query` and `aria_run_task` stay disabled until this catalog is stable.
