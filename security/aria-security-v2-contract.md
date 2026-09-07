# ARIA Security 2.0 — Contract

## Authority
Security 2.0 is the fail-closed security control plane for autonomous actors and executors.

## Required controls
- Identity registry per actor/agent.
- Capability grants with explicit least-privilege allow lists.
- Risk ceilings.
- Secret isolation: no raw secret material in envelopes, state, or audit records.
- Signed action envelopes with expiry and nonce when a signing key is configured.
- Append-only audit boundary.
- Tamper-evident state hash.
- Kill switch scopes: missions, agents, executors, self_development, self_modification.
- Global emergency stop.
- Identity and capability revocation.
- Integrity/recovery gate before trusting state.

## Fail-closed invariants
- Missing identity/grant denies execution.
- Revoked identity denies execution.
- Revoked capability denies execution.
- Active kill switch denies execution.
- Excess risk denies execution.
- Human-gated actions never reach an executor through this control plane.
- Expired or invalid action envelopes deny execution.
- Invalid state integrity denies recovery.

## Scope
This control plane governs authorization and evidence. It does not itself grant credentials, bypass external provider security, or expose secrets.
