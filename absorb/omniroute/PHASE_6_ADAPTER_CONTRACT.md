# OmniRoute — Phase 6 Adapter Contract

Status: PASS / IMPLEMENTED / NOT ENABLED

## Purpose
Provide the protocol-specific adapter boundary between ARIA Execution 10.13 and the already-certified OmniRoute gateway.

## Authority
ARIA remains authoritative for route selection, capability selection, permission/Human Gate, mission lifecycle, verification, evidence, canonical persistence, learning and lifecycle decisions.

## Required invariants
1. Input is a route already selected and authorized by ARIA.
2. Provider id is exactly `omniroute`.
3. One provider request per execution attempt.
4. Credential arrives only through the existing injected resolver.
5. Secret is sent only as the outbound Bearer header and never returned or logged.
6. Endpoint is HTTP loopback only (`127.0.0.1`, `localhost`, or `::1`).
7. Payload is translated to OpenAI-compatible `/v1/chat/completions`.
8. `route.omniroute_provider` is only a preselected routing hint; the adapter does not choose it.
9. Provider/model/route metadata is non-secret; unknown values remain null.
10. Transport errors, timeout, non-2xx, malformed responses and unsupported capabilities fail closed.
11. No retry, fallback, account hopping, quota mutation, router mutation or memory writes.
12. Streaming is forwarded only when the caller explicitly requests it; Phase 6 certification uses non-stream normalization.

## Runtime registration
adapter_id = `omniroute_gateway_chat_completions`
provider_id = `omniroute`
interface = `http_json`
operation = `text_generation`

Registration does not make OmniRoute selectable by itself. A valid ARIA model/account/capability route is still required.

## Canonical endpoint
`http://127.0.0.1:20128/v1/chat/completions`

Configuration default only. Phase 6 does not enable the OmniRoute runtime.

## Closure gate
Phase 6 is PASS only when the focused adapter contract, execution registration and regression tests pass, live I/O remains disabled outside an explicitly controlled transport, and no ARIA authority boundary is broadened.
## Evidence — 2026-10-05
- GitHub Actions Phase 6 run `37258125338` = SUCCESS.
- Syntax checks = PASS.
- OmniRoute adapter contract = PASS.
- Existing adapter boundary = PASS.
- Execution regression = PASS.
- Phase 6 evidence artifact = `aria-omniroute-phase6-adapter-evidence`.
- Live I/O remained disabled outside injected test transport.
- OmniRoute runtime/provider integration remains globally disabled until later governed phases.