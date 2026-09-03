# ARIA Worker — Adapter Layer + Control Plane

Current package version: **2.4.0**.

This repository contains ARIA's governed control-plane, execution adapters, autonomous layers and the real-activation integration runtime. Architecture completion does not imply that every external account is configured or that production operations have been executed.

## Real Activation / Integration — Phase 1

`activation/` is the operational bridge from declared connectors to real service calls.

- `activation/config.js` — canonical connector activation manifest.
- `activation/contract.js` — activation states and validation rules.
- `activation/secrets.js` — environment-backed resolver for canonical `secret://provider/account` references.
- `activation/http.js` — timeout-aware HTTP transport with header and payload redaction.
- `activation/redaction.js` — recursive secret redaction.
- `activation/connectors.js` — live adapter surfaces for GitHub, Supabase, Cloudflare and Notion, plus explicit host/provider boundaries for Web, Filesystem and Image/Multimedia.
- `activation/runtime.js` — health probes, state snapshot and governance-bound execution.
- `activation/bootstrap.js` — unified ARIA runtime entry point including Activation.
- `activation/live-smoke.js` — real-environment smoke runner; it reports only redacted state.
- `activation/integration-matrix.json` — connector/capability/risk matrix.
- `ACTIVATION_PHASE.md` — operator runbook and activation gate.

### Safety model

External operations are never enabled merely because a connector exists. A connector must be enabled, configured, healthy, authorized and credential-resolved immediately before the call. Write/destructive operations remain subject to the existing Governance/Human-Gate boundary. Secrets are not committed, logged, returned in snapshots or persisted by the activation layer.

### Commands

`npm test` runs the full regression suite, including real-activation contract tests.

`npm run test:activation` runs only the activation suites with mock transports.

`npm run smoke:live` performs live health probes using the environment credentials present at runtime; no credentials are stored in the repository.

### External API surfaces verified for this phase

Supabase Management API supports authenticated project management, database migrations and project logs. Cloudflare Workers exposes version/deployment APIs and observability. GitHub exposes repository and Actions REST APIs. The implementation intentionally keeps protocol-specific details behind adapters and leaves provider-specific write contracts explicit where a payload must be supplied by the host/runtime.

## Existing architecture

```
Provider → Model → Capability → Account → Quota → Router → Fallback → Execution → Governance → Tool/MCP Gateway
```

```
Core → Tools → Connectors → Execution → Self-Development → Autonomy → Multi-IA → Multi-Agent → Platform → Activation
```

The Grok external-client flow remains opt-in and paused; it is not required for the real-service activation layer described here.
