# BLOCK 12 — CONTINUOUS SELF-IMPROVEMENT LOOP

## Objective
Create ARIA's canonical Cognitive Evolution Loop by composing the already-certified mission, observation, planning, execution, verification, reflection, learning, skill update, gap identification, self-development, testing and promotion boundaries.

## Canonical flow
`MISSION → OBSERVE → PLAN → EXECUTE → VERIFY → REFLECT → LEARN → UPDATE SKILL → IDENTIFY GAP → SELF-DEVELOP → TEST → PROMOTE → BETTER ARIA`

## Required properties
- Sequential, explicit stage boundaries.
- Immediate propagation of each stage's result to downstream stages.
- Fail-closed on `blocked`, `failed`, or malformed stage output.
- Promotion is explicit and cannot be inferred from preceding stages.
- Bounded cycles; no unbounded self-modification loop.
- Deterministic control-plane orchestration.
- No credentials, network authority, production deployment authority, or direct persistence authority in the loop.
- Existing Security, Economic Router, Planner, Execution Engine, Verification, Learning and Self-Development components remain authoritative for their domains.
