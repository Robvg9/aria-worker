# OmniRoute Phase 10 — Recovery / Disconnect Contract v1.0.0

## Objective
Prove that a mission can survive OmniRoute interruption without losing canonical mission progress.

## Canonical sequence
`ARIA mission → OmniRoute available → execute → STOP/interruption → checkpoint → recovery → START/health verified → continue → verify → persist`.

## Authority boundary
ARIA's canonical mission state remains owned by `execution/mission-state.js` and its repository. This module is only a governed recovery boundary.

## Hard gates
1. Checkpoint captures `mission_id`, current step, completed steps and selected route context.
2. Interruption moves a running mission to the canonical `waiting` state; it never marks success.
3. Resume requires verified gateway health evidence.
4. Resume restores the same `mission_id` and checkpoint position.
5. No duplicate mission, step rewind or synthetic success is created.
6. No persistence writer, process control, network call or secret access is performed by this module.

## Gate
Mission survives a modeled OmniRoute interruption and can continue with the same canonical identity/progress.

## Non-goals
Physical stop/start of OmniRoute and LIVE Supabase/E2E persistence remain later runtime gates.