# ARIA ABSORB — OmniRoute Gateway Adapter Contract v1.0

Status: SOURCE-LOCKED / AUDITED / NOT ENABLED
Case: OmniRoute
Capability target: `omniroute.gateway`
Branch: absorb/omniroute-v1-certification-20261003

## Canonical source

- Repository: `diegosouzapw/OmniRoute`
- Ref: `release/v3.8.52`
- Audited commit: `3e66ff2e8cc94821b093fe57dad667b585230cd1`
- License observed: MIT
- Source lock file: `absorb/omniroute/SOURCE_LOCK.json`

The commit SHA is the reproducibility anchor. A cryptographic artifact digest remains pending until an authorized sandbox captures the exact installation artifact. No digest is fabricated.

## Authority boundary

ARIA remains the authority for:

- planning and task intent
- capability selection
- permissions and Human Gate
- mission lifecycle
- verification
- evidence
- canonical persistence
- learning and lifecycle decisions

OmniRoute may provide only:

- OpenAI-compatible gateway handling
- provider/model routing inside the ARIA-approved set
- request/response translation
- fallback and gateway-local resilience
- inference transport

OmniRoute must never become the mission authority, canonical memory, canonical capability registry, or permission authority.

## Adapter boundary

The eventual adapter must use the existing ARIA governed gateway boundary in `mcp-gateway/dispatch.js`.

The adapter must:

1. accept only the normalized ARIA gateway request;
2. preserve `request_id`, `execution_id`, `authorization_id`, `tool_id`, and `operation`;
3. never acquire, persist, or emit provider secrets;
4. never write canonical mission state or memory directly;
5. normalize timeout, connection, 429, 5xx, malformed-response, quota and provider-unavailable conditions as failures;
6. expose provider/model/latency metadata only as non-secret evidence;
7. never turn an unverified response into mission success;
8. remain opt-in until Phases 3–5 are independently green.

## Capability contract

Initial operation vocabulary:

- `health`
- `models`
- `chat`
- `stream`
- `route`

Proposed local endpoint:

`http://127.0.0.1:20128/v1`

That endpoint is a configuration target only. Availability is proven exclusively by a real health probe in the sandbox.

## Absorb classification

| OmniRoute surface | ARIA treatment |
|---|---|
| OpenAI-compatible `/v1/*` gateway | WRAP / ADAPTER |
| Provider translation | ADAPT |
| Fallback / cooldown / lockout | ADAPT as ARIA failure/resilience semantics |
| Quota-aware routing | ADAPT as subordinate routing information |
| Auto-Combo | ADAPT; ARIA remains authority |
| Circuit breaker | REUSE AS PATTERN |
| Local providers, including Ollama | WRAP / ADAPTER |
| Telemetry / health | ADAPT into ARIA evidence/observability |
| Dashboard | CONSUME ONLY |
| OmniRoute SQLite state | CONSUME ONLY; never canonical ARIA state |
| MCP / A2A | FUTURE / separate audit |
| Provider credentials | NEVER duplicate into ARIA unless an existing governed secret path requires it |
| Planner / mission authority / memory authority | NO ABSORB |

## Security floor

Bootstrap must remain loopback-only. Hardened self-host configuration must require authentication before any non-loopback exposure. ARIA's own permission and verification gates remain authoritative even when OmniRoute has its own guardrails.

Supply-chain rule: install only from the locked source/ref or a release artifact whose digest is captured. Do not use `latest` as the certification input.

## Gate order

`Source Lock → Audit → Sandbox → Standalone → Provider → Adapter → Router → Resilience → Recovery → Security → E2E → Negative → Evaluation → Registration`

Phase 6+ runtime implementation is prohibited until:

- Phase 3 isolated installation is PASS;
- Phase 4 standalone smoke is PASS;
- Phase 5 OmniRoute → Ollama → Qwen is LIVE PASS.

## Explicit non-goals

This case must not:

- replace ARIA Router v2;
- replace Resource Intelligence;
- replace Capability Registry;
- replace Permissions/Human Gate;
- replace Mission Runtime;
- create a second Verification/Evidence/Memory subsystem;
- expose `omniroute.gateway` as globally available before verification;
- copy OmniRoute SQLite state into ARIA canonical state;
- integrate directly into `main` without the complete certification pipeline.

## Current gate state

- Phase 1 — SOURCE LOCK: PASS (commit locked)
- Phase 2 — AUDIT: PASS (static, source-reviewed)
- Phase 3 — SANDBOX: BLOCKED because both authorized Desktop Commander Windows devices are currently offline.
- Phases 4–15: PENDING / BLOCKED by the Phase 3 gate.

No later phase is marked PASS by inference.
