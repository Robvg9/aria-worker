# Mission 9.5 — First External AI / Grok

## Implemented

- OAuth 2.1-shaped authorization server with Authorization Code + PKCE S256.
- Dynamic MCP client registration with HTTPS / localhost redirect allowlist.
- Supabase Auth email OTP as the human identity step.
- Short-lived pending authorization state (10 min) and one-time auth codes (60 sec).
- OAuth access tokens encrypted at rest using a key derived from the existing Supabase service-role secret; no OAuth secret is committed to Git.
- Authenticated MCP resource endpoint for Grok with `aria_context` and `aria_memory_capture`.
- `aria_memory_capture` delegates to the existing `aria-memory-bridge-9-4`; no direct canonical memory write.
- Grok connector configuration with `oauth = true`.
- Repository contract/security tests included in full `npm test`.

## Deployment contract

Target Supabase project: `icuqsstxfdbvjytkhlog` (ARIA). The deployable functions are:

- `aria-mcp-oauth-v1`
- `aria-mcp-server-9-5`

The existing Bridge remains unchanged and keeps its current fail-closed gate.

## Final E2E condition

The server-side implementation can be deployed and verified independently. End-to-end completion also requires the owner to add the endpoint as a Custom Connector in Grok and complete the one-time browser OAuth authorization. That account-level action is outside the available ARIA/GitHub/Supabase tooling.

Mission 9.5 is therefore considered **server/runtime implemented and deployable**, but not falsely marked as fully E2E-validated until the Grok account-side authorization is observed.
