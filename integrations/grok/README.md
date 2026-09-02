# ARIA ↔ Grok — Mission 9.5

## Runtime endpoint

`https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-server-9-5`

The MCP endpoint exposes `aria_context` and `aria_memory_capture` and requires a valid ARIA OAuth bearer token. The protected-resource metadata advertises the ARIA OAuth authorization server.

## OAuth flow

Grok is an OAuth-capable MCP client. ARIA provides a standards-shaped authorization-code + PKCE flow backed by Supabase Auth:

1. Grok discovers `/.well-known/oauth-protected-resource` on the MCP resource.
2. Grok follows the advertised authorization server metadata.
3. Grok dynamically registers its redirect URI.
4. The browser authorization page asks the ARIA user for email and sends a one-time Supabase Auth code.
5. The verifier is checked with PKCE S256.
6. A short-lived authorization code is exchanged for a Supabase access token.
7. The MCP endpoint validates that bearer token with `auth.getUser()`.

OAuth authorization codes expire after 60 seconds. Browser authorization state expires after 10 minutes. Stored access tokens are encrypted at rest using a key derived from the Supabase service-role secret; plaintext tokens are never committed to Git or emitted in logs.

## Memory boundary

`aria_memory_capture` always enters the existing `aria-memory-bridge-9-4` boundary. The Bridge remains the authority for write permission, idempotency, rate limits and the CAPTURE → GATE → COMMIT → SYNC pipeline. The Grok MCP server never writes canonical memory directly.

## Required final human step

The repository and Supabase runtime can be deployed and verified independently. The final end-to-end step still requires the owner to add this MCP as a Custom Connector in Grok and complete the one-time browser OAuth authorization. That account-level action cannot be performed by ARIA tooling.
