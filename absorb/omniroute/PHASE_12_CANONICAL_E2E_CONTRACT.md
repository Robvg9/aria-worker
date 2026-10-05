# OmniRoute Phase 12 — Canonical ARIA E2E Contract v1.0.0

## Canonical chain
`ARIA task → security gate → Router/Auto-Combo → checkpoint → Execution adapter → verification → persistence/recovery evidence`.

## Authority boundary
ARIA remains authoritative for mission/task/capability, authorization, approved route set, security policy, verification and persistence. OmniRoute supplies gateway execution only.

## Success gate
A canonical run may return `succeeded` only when the Execution result is `succeeded` and the canonical verifier passes.

## Failure gate
Execution failure never becomes success. The result is classified and passed to the governed Phase 9 fallback planner.

## LIVE probe
`scripts/omniroute-phase12-live.mjs` is a reproducible external probe. It requires a caller-supplied `OMNIROUTE_API_KEY` at runtime; the key is never persisted or written to evidence.

## Current certification
The integration chain is testable with injected transport/credential dependencies. Canonical LIVE requires the local OmniRoute gateway and a valid runtime credential.