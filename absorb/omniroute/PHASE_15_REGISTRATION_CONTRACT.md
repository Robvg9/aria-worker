# OmniRoute Phase 15 — Registration / Promotion / Evolution

## Registration state
`PENDING_LIVE_E2E` with `active=false` is the only valid state for the current evidence.

## Required record
Capability ID, source/provenance, version, permissions, dependency, health, evidence, rollback, owner/limitations and evolution rules are recorded before promotion.

## Promotion gate
Registration must not make OmniRoute available until canonical LIVE/E2E + persistence + negative/security gates are all green.

## Evolution gate
Every new version must repeat source lock, isolated audit, tests, negative certification, comparison and LIVE/E2E before replacing the currently certified version.