# OmniRoute Phase 15 — Registration / Promotion / Evolution

## Registration state
`REGISTERED` with `active=false` and `enablement=DISABLED` is the certified state for the current evidence. Registration is opt-in only; the default ARIA route is unchanged.

## Required record
Capability ID, source/provenance, version, permissions, dependency, health, evidence, rollback, owner/limitations and evolution rules are recorded before promotion.

## Promotion gate
The registration gate is green after canonical LIVE/E2E + persistence + negative/security gates are all green. Registration does not enable default availability.

## Evolution gate
Every new version must repeat source lock, isolated audit, tests, negative certification, comparison and LIVE/E2E before replacing the currently certified version. Default enablement requires a separate explicit policy decision and post-enable smoke test.