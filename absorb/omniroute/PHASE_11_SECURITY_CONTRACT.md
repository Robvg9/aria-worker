# OmniRoute Phase 11 — Security & Authority Gate v1.0.0

## Authority
ARIA Security 2.0 remains the authorization authority. This boundary never grants permissions, bypasses ARIA policy, or treats OmniRoute guardrails as sufficient authorization.

## Controls
- Loopback-only HTTP gateway.
- No URL userinfo.
- Explicit provider allowlist.
- Canonical `secret://` / `env://` credential reference only; raw secret material rejected.
- Bounded integer timeout.
- Input serialization and size limit.
- Explicit CORS/Origin allowlist; `*` rejected.
- Optional encrypted-storage verification must be explicit when required.
- Provider errors are sanitized/redacted.
- Provider/model output is untrusted and has no execution authority.
- Suspicious instruction patterns are observable but never executable by this boundary.

## SSRF boundary
Remote/private/LAN hosts are denied by construction because the gateway endpoint must be HTTP loopback. The module performs no DNS/network resolution itself.

## Gate
Security contract passes without duplicating ARIA Security 2.0 authorization.

## Non-goals
Live server CORS configuration, encryption-at-rest provisioning, real provider credential resolution, and canonical LIVE/E2E remain later runtime gates.