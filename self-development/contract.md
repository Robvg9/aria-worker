# ARIA Self-Development Engine — Block 5/9 + Self-Development 2.0

Controlled self-improvement orchestration.

## Existing governed pipeline
- 5.1 Self Inspection
- 5.2 Self Diagnosis
- 5.3 Improvement Planner
- 5.4 Change Executor
- 5.5 Self Testing
- 5.6 Change Verification
- 5.7 Self Rollback
- 5.8 Self Documentation
- 5.9 Self-Development Coordinator

## Self-Development 2.0
- Capability Gap Engine: goal → required capabilities → verified/available capabilities → explicit gaps.
- Self-Development Planner: gap → research → design → implement → test → verify → learn → promote.
- Branch-Isolated Sandbox: all experimental mutations are staged on a non-main branch; production is never the sandbox.
- Change Risk Analyzer: impact/dependency/protected-path analysis produces risk and approval requirements before mutation.
- Automatic Regression Builder: verified skills generate deterministic regression artifacts that can detect capability drift.

## Safety contract
- Inspection is read-only.
- Diagnosis produces findings, never authorization.
- Planning produces bounded change plans, never direct execution.
- Capability gaps do not grant permissions.
- Protected production paths fail closed.
- Sandbox creation requires a branch-capable workspace; `main` and `master` are forbidden.
- Sandbox promotion requires positive verification and creates a governed pull request; it does not merge directly.
- High/destructive changes require elevated review or Human Gate according to risk policy.
- Tests and verification are injected capabilities.
- Rollback is snapshot/compensation based and requires explicit handlers.
- Deployment is not implicit; this block does not bypass Router, Permission, Gateway, Credential Boundary, or Governance.
- No secrets or hidden durable state are introduced.
- A failed/unverified learning result can create diagnostics but cannot produce an active reusable capability.

## LIVE certification
The repository contains a one-shot GitHub Actions certification for the 2.0 sandbox boundary. It validates the real branch workspace, read/write isolation, regression generation, and governed PR promotion, then closes and deletes its temporary artifacts.

Certification workflow hardening: the runner executes the live probe inside an explicit CommonJS async boundary.
