# ARIA Optima — Verified Pricing Signal v1

## Purpose

Prevent the economic optimizer from interpreting missing, malformed, or unverified prices as a free provider/model.

## Contract

- A unit price is known only when `usd_per_1k` is a finite non-negative number and `cost_evidence` contains a non-empty `source_id`, `observed: true`, and `verified: true`.
- A verified zero price is represented as `cost_status: verified_free`.
- Missing, malformed, or unverified prices are represented as `usd_per_1k: null` and `cost_status: unknown`.
- Unknown pricing receives no cost-efficiency utility credit.
- Callers that must enforce a cost-aware choice use `require_known_cost: true`; the optimizer returns `null` when no candidate has verified pricing.
- The optimizer is a ranking helper only. It does not authorize execution and is not a substitute for the transactional mission-budget ledger.
- Predicted costs and post-call usage remain distinct. Runtime mission policies still fail closed when their required token/cost estimate is unknown.

## Validation

`tests/cost-optimizer-pricing-evidence-v1.test.js` covers absent, unverified-zero, verified-free, verified-paid and malformed price inputs; strict unknown-price rejection; deterministic selection; and input immutability.

## Safety boundary

No production registry, provider credential, billing setting, quota, mission policy, or live runtime was changed by this patch.
