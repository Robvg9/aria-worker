# ARIA Worker — Adapter Layer + Control Plane

Current package version: **2.4.2**.

This repository contains ARIA's governed control-plane, execution adapters, autonomous layers and the real-activation integration runtime. Architecture completion does not imply that every external account is configured or that production operations have been executed.

## Real Activation / Integration — Phase 1

`activation/` is the operational bridge from declared connectors to real service calls.

- `activation/config.js` — canonical connector activation manifest.
- `activation/contract.js` — activation states, risk classes and trusted provider origins.
- `activation/secrets.js` — environment-backed resolver for canonical `secret://provider/account` references.
- `activation/http.js` — timeout-aware HTTP transport with header and exact-secret response redaction.
- `activation/redaction.js` — recursive secret redaction.
- `activation/connectors.js` — live adapter surfaces for GitHub, Supabase, Cloudflare and Notion, plus explicit host/provider boundaries for Web, Filesystem and Image/Multimedia.
- `activation/runtime.js` — health probes, state snapshot and governance-bound execution with operation-risk enforcement.
- `activation/bootstrap.js` — unified ARIA runtime entry point including the actual Core module paths.
- `activation/live-smoke.js` — real-environment smoke runner; it reports only redacted state.
- `activation/integration-matrix.json` — connector/capability/risk matrix.
- `ACTIVATION_PHASE.md` — operator runbook and activation gate.

### Safety model

External operations are never enabled merely because a connector exists. A connector must be enabled, configured, healthy, authorized and credential-resolved immediately before the call. Credentialed provider origins are allowlisted. Operation risk is declared by the adapter and cannot be downgraded by the caller. Governance receives relevant destination parameters. Secrets are not committed, logged, returned in snapshots or persisted by the activation layer.

### Commands

`npm test` runs the full regression suite, including real-activation contract tests.

`npm run test:activation` runs only the activation suites with mock transports.

`npm run smoke:live` performs live health probes using the environment credentials present at runtime; no credentials are stored in the repository.

### External API surfaces verified for this phase

GitHub REST supports repository Contents writes, Git refs and workflow dispatch. Supabase Management API supports read-only SQL, migrations, logs and Edge Functions. Cloudflare Workers API supports script content, versions, deployments and Tails. Notion API supports page search/read and Markdown content updates.

The implementation keeps protocol-specific details behind adapters. Provider-specific permissions/scopes and runtime payloads remain explicit; tests use mock transports and do not claim production connectivity.

## Existing architecture

```
Provider → Model → Capability → Account → Quota → Router → Fallback → Execution → Governance → Tool/MCP Gateway
```

```
Core → Tools → Connectors → Execution → Self-Development → Autonomy → Multi-IA → Multi-Agent → Platform → Activation
```

The Grok external-client flow remains opt-in and paused; it is not required for the real-service activation layer described here.
