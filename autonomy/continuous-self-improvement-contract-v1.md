# ARIA Continuous Self-Improvement Loop v1

## Purpose
Compose existing ARIA control-plane authorities into one bounded Cognitive Evolution Loop without duplicating execution, verification, learning, self-development, authorization, or memory authority.

## Canonical stages
`MISSION → OBSERVE → PLAN → EXECUTE → VERIFY → REFLECT → LEARN → UPDATE SKILL → IDENTIFY GAP → SELF-DEVELOP → TEST → PROMOTE → BETTER ARIA`

## Rules
1. Every stage is an injected capability boundary. This orchestrator does not implement downstream business logic.
2. `blocked` or `failed` at any stage stops the cycle immediately.
3. Promotion is never implicit; a `blocked`/`failed` promotion result closes the cycle.
4. No stage may bypass Security 2.0 authorization or existing execution boundaries.
5. The loop is bounded by `maxCycles` (1..10); it never runs indefinitely.
6. The loop is deterministic with respect to supplied stage functions and inputs; it has no time, network, credential, or persistence authority.
7. `BETTER ARIA` is a terminal declaration only after all preceding stages succeed and promotion succeeds.
8. Failures remain observable in the stage trace and are not converted into success.

## Non-goals
- No direct tool/model/agent execution implementation.
- No credential resolution.
- No autonomous production deployment or permission grant.
- No direct memory persistence.
- No replacement of existing Planner, Execution Engine, Smart Verifier, Learning Engine, Self-Development, Security, or Economic Router authorities.
