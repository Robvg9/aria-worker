# ARIA ABSORB — OmniRoute Static Audit v1

## Result

Phase 2 static audit is complete against the locked `release/v3.8.52` source commit:

`3e66ff2e8cc94821b093fe57dad667b585230cd1`

The audit is intentionally static. No OmniRoute code was executed during the audit.

## Evidence reviewed

- repository metadata and release history;
- `package.json` at the locked release branch;
- self-host documentation;
- architecture/routing documentation;
- recent release commits affecting authorization, error sanitization, build/release integrity and quality gates.

## Relevant observed capabilities

OmniRoute presents an OpenAI-compatible inference gateway, local endpoint support, provider/model routing, fallback behavior, quota/circuit resilience, streaming, health/telemetry and local persistence. These are potential infrastructure capabilities for ARIA, not replacements for ARIA's control plane.

## Reusable patterns

1. provider gateway abstraction behind an external boundary;
2. provider fallback/cooldown/lockout semantics;
3. quota-aware provider selection;
4. circuit-breaker style resilience;
5. local-provider bridging;
6. explicit loopback and API-key hardening for self-hosting;
7. non-secret provider/model/latency observability;
8. exact-SHA release discipline.

## Rejected as authority

The following remain outside the ARIA authority plane:

- planner;
- mission lifecycle;
- permissions/Human Gate;
- canonical capability registry;
- canonical verification/evidence;
- canonical memory;
- canonical mission persistence.

## Supply-chain findings

The audited release branch contains current engineering changes, including authorization hardening and error sanitization. Release documentation also shows version-document drift in at least one self-host guide, so ARIA must bind to the exact code ref/SHA rather than treating documentation version strings as source identity.

The certification input therefore remains the locked commit, not `latest`, not an unverified Docker tag, and not a package version string alone.

## Current blockers

Phase 3 is a real-environment gate. The two authorized Desktop Commander devices are offline:

- LaCueva — offline
- RobVG — offline

Therefore the following are not claimed:

- installation success;
- process startup;
- `/healthz` success;
- `/v1/models` success;
- streaming success;
- restart/persistence success;
- Ollama/Qwen bridge success.

## Promotion rule

No Phase 6 runtime adapter, registry enablement, or production provider routing is allowed until Phases 3–5 produce independent real evidence.