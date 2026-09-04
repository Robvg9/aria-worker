# ARIA Worker — Adapter Layer + Control Plane

Current package version: **2.5.2**.

This repository contains ARIA's governed control-plane, execution adapters, autonomous layers and the real-activation integration runtime. Architecture completion does not imply that every external account is configured or that production operations have been executed.

## Autonomous Execution Fabric

### AF-2 — Mission State

Persistent mission lifecycle, steps, checkpoints and mission events provide the durable state boundary for autonomous work.

### AF-3 — Device / Terminal Execution

A transport-neutral device execution contract with Termux as the first executor. Device tokens are hashed, the device never receives the service-role secret, jobs are atomically claimed, and results are returned with explicit success/failure/timeout states.

### AF-4 — Autonomous Mission Orchestrator

`autonomy/orchestrator.js` is the mission-level orchestration layer. It connects persistent mission state to an injected planner, executor and verifier while preserving existing governance boundaries.

- plans are persisted as checkpoints and can resume from `completed_steps`;
- steps receive deterministic IDs for stable recovery;
- autonomy requires explicit `enabled: true`;
- per-mission step and runtime budgets are enforced;
- step risk is checked against the autonomy policy before execution;
- retries are bounded and restricted to retryable `failed`/`timeout` outcomes;
- each step is verified before the next step runs;
- final goal verification is mandatory before `succeeded`;
- planning failures and policy violations become explicit `blocked` states rather than silent execution.

AF-4 is the orchestration layer; executors such as Termux remain the data-plane workers.

## Real Activation / Integration — Phase 1

**Status: COMPLETE AND AUDITED.** Phase 1 has been validated with the full regression suite and a real, explicitly human-approved GitHub `repo_read` E2E. No remaining technical work belongs exclusively to this phase.

`activation/` is the operational bridge from declared connectors to real service calls.

- `activation/config.js` — canonical connector activation manifest.
- `activation/contract.js` — activation states, risk classes and trusted provider origins.
- `activation/secrets.js` — environment-backed resolver for canonical `secret://provider/account` references.
- `activation/http.js` — timeout-aware HTTP transport with header and exact-secret response redaction.
- `activation/redaction.js` — recursive secret redaction.
- `activation/connectors.js` — live adapter surfaces for GitHub, Supabase, Cloudflare and Notion, plus explicit host/provider boundaries for Web, Filesystem and Image/Multimedia.
- `activation/runtime.js` — health probes, state snapshot and governance-bound execution with operation-risk enforcement.
- `activation/bootstrap.js` — unified ARIA runtime entry point including the actual Core module paths.
- `activation/live-smoke.js` — real-environment smoke runner that probes credentialed providers actually configured in the environment.
- `activation/integration-matrix.json` — connector/capability/risk matrix.
- `ACTIVATION_PHASE.md` — operator runbook and activation gate.

### Safety model

External operations are never enabled merely because a connector exists. A connector must be enabled, configured, healthy, authorized and credential-resolved immediately before the call. Credentialed provider origins are allowlisted. Operation risk is declared by the adapter and cannot be downgraded by the caller. Governance receives relevant destination parameters. Secrets are not committed, logged, returned in snapshots or persisted by the activation layer.

### Commands

`npm test` runs the full regression suite, including real-activation and AF-4 orchestration tests.

`npm run test:activation` runs only the activation suites with mock transports.

`npm run smoke:live` performs live health probes using the environment credentials present at runtime; no credentials are stored in the repository.

### External API surfaces verified for this phase

The activation architecture defines controlled adapter boundaries for GitHub, Supabase, Cloudflare and Notion/ChatBending, with host/provider boundaries for Web, Filesystem/Workspace and Image/Multimedia.

The implementation keeps protocol-specific details behind adapters. Provider-specific permissions/scopes and runtime payloads remain explicit. The phase's live validation includes GitHub repository-read execution through the governed runtime; other providers remain configuration-dependent and are not claimed as live-verified merely by contract tests.

## Existing architecture

```
Provider → Model → Capability → Account → Quota → Router → Fallback → Execution → Governance → Tool/MCP Gateway
```

```
Core → Tools → Connectors → Execution → Self-Development → Autonomy → Multi-IA → Multi-Agent → Platform → Activation → Autonomous Execution Fabric
```

The Grok external-client flow remains opt-in and paused; it is not required for the completed real-service activation layer described here.
