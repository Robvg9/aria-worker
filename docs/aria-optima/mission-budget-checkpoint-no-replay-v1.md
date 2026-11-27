# ARIA Optima — Mission Budget Checkpoint / No-Replay v1

## Contract

When a mission-backed provider or agent runtime returns a `mission_budget_*` error:

1. Stop before independent external verification or any further provider/tool step.
2. Do not switch provider, agent, retry the failed step, or replan the mission.
3. Persist the original plan, completed step IDs, attempts, step results, and pending execution-job references.
4. Persist a mission-level `blocked` state with recovery status `mission_budget_blocked` and `replan_required: false`.
5. Release the mission lease and emit checkpoint/block evidence.
6. Reject the generic PWA `/retry` endpoint for this state; a new mission must not be silently created from the same objective.
7. The PWA displays the owner-review requirement and does not offer the generic retry button.

## Owner review required

Before any future reactivation, the owner must verify provider quota recovery, reconcile every UNKNOWN reservation or ambiguous upstream outcome, define and approve explicit mission budget limits, and use a dedicated governed resume path that preserves the checkpoint. This patch does not invent limits, prices, tokens, or currency.

## Validation

The existing `tests/mission-runner-ssot-regression.test.js` suite asserts the runner short-circuit, durable checkpoint fields, no retry/replan scheduling, API retry fence, and PWA action suppression.

## Deployment boundary

This is code and CI only. No LIVE migration, deployment, provider call, secret change, agent installation, policy row, or mission unfreeze is performed.
