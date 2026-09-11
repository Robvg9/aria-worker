# ARIA MCP Inbound (Grok Free → ARIA)

Direction: **Grok → ARIA only**. Does not call the xAI paid API.

## Auth (canonical)

**OAuth 2.1 + PKCE S256** with colocated Authorization Server.

Canonical resource (RFC 8707):

```
https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1
```

- Access token: ARIA-signed HS256 JWT (`aud` = resource, `scope` = `aria.mcp.inbound`, TTL 1h)
- Refresh token: opaque, hashed at rest, rotated on every use (30d)
- DCR: `POST …/register`
- CIMD: HTTPS `client_id` accepted when metadata redirect_uris match
- Discovery (`initialize`, `tools/list`) public; `tools/call` requires Bearer access token

## Why previous OAuth generations failed

1. Access token was Supabase user JWT (`expires_in: 3600`) **without refresh** → tools vanished after 1h.
2. HTTPS `client_id` (CIMD) rejected.
3. Resource advertised as `aria.robvg9.workers.dev/mcp` while function lived on supabase.co.
4. Magic-link OTP friction instead of simple consent.

## Endpoints

| Path | Purpose |
|------|---------|
| `GET /.well-known/oauth-protected-resource` | RFC 9728 |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 |
| `POST /register` | DCR |
| `GET /authorize` | Authorization + consent |
| `POST /authorize/consent` | User decision |
| `POST /token` | code + refresh grants |
| `POST /` (JSON-RPC) | MCP streamable HTTP |

## Grok setup

1. Deploy function + run migration `20260911_aria_mcp_oauth_refresh.sql`.
2. Set secret `ARIA_MCP_OAUTH_SECRET` (≥32 chars). Fallback: `ARIA_MCP_INBOUND_TOKEN`.
3. grok.com → Connectors → Custom → paste MCP URL above.
4. Complete OAuth consent once.
5. Call `aria_status` then `aria_context`.

Phase 1 tools only: `aria_status`, `aria_context`.
