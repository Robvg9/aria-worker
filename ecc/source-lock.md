# ECC → ARIA Source Lock v1

## Purpose

Freeze the exact ECC release that ARIA is integrating. The lock records provenance; it does not grant permissions.

## Locked source

- Upstream: https://github.com/affaan-m/ECC
- Release tag: `v2.2.3`
- Tag object SHA: `93f9f6154d164ccb9f4dc38858a2bc2d5dcab222`
- Release target commit: `c05b2d6614f62f6db0047669aa4eefb223d478f9`
- GitHub tag signature: **verified**
- License: MIT
- `package.json`: 2.2.3
- `agent.yaml`: 2.2.3
- `VERSION`: 2.2.3

## Snapshot hashes

- `package.json` → `983370b3af5f1d12a8fe7b41ab1e3aee74923367`
- `agent.yaml` → `11df81720cafdad60a11f8ae583c8ec4a76771d5`
- `VERSION` → `585940699b5b99df6541c819a773ef738985a956`
- `docs/architecture/cross-harness.md` → `768414b72432115fe885fecdd9ef72751a6b9742`

## Reconciliation

Earlier research recorded a version/release-surface inconsistency. A fresh live re-verification of the signed `v2.2.3` release on 2026-10-02 shows the three version surfaces aligned at **2.2.3**.

Therefore the prior discrepancy is recorded as **RESOLVED_AT_LOCKED_RELEASE**, not left as an active drift finding.

## External registry

`ecc-universal` 2.2.3 is recorded as an external registry observation only. ARIA's source of truth remains the signed GitHub release commit.

## ARIA binding

ARIA already exposes ECC through the governed `tool_ecc_operator` / `ecc.execute` boundary. This Phase 0 lock adds provenance and does **not** expand ECC permissions.

## Phase 0 completion contract

`UPSTREAM IDENTIFIED → SIGNED RELEASE LOCKED → SNAPSHOT HASHES RECORDED → VERSION SURFACES VERIFIED → ARIA BINDING RECORDED → PR/CI`

## Next phase

**Phase 1 — Live Inventory Compiler:** discover the complete ECC filesystem/catalog from the locked release rather than using hardcoded counts.
