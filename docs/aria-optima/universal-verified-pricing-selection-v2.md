# ARIA Optima — Universal Verified Pricing Selection v2

## Decision

A model is not treated as free or cheap based on labels alone. `tier: free`, `cost: "$0"`, numeric zero, and `metadata.free_tier` are not pricing evidence.

## Required pricing evidence

For a registry price to influence routing, the `pricing.cost_evidence` object must contain:
- `source_id`: non-empty source reference;
- `observed: true` and `verified: true`;
- exact `provider_id`, `account_id`, and `model_id` matching the currently selected route.

Both input and output rates must be finite and non-negative. Both must be zero to earn the verified-free score. A verified, non-zero price receives the paid-cost signal. Missing, partial, malformed, identity-mismatched, or unverified pricing remains unknown and receives no cost advantage.

## Google Gemini Direct exception

The Android autonomous decision selector may use the separately capability-verified Google Direct model only when it resolves to the dedicated `acct_google_gemini_free` account. A different Google account cannot inherit the exception by model-name suffix.

## Validation

- `tests/intelligent-router-v2.test.js`: unknown zero labels, verified free, verified paid, missing input/output price, and identity mismatch.
- `tests/mission6-router-v2-gateway-contract.test.js`: Android Google account exception, OpenRouter verified-free identity, and Mission 6 scorer evidence checks.
- Both tests remain in the standard `npm test` suite and the PWA Test Center catalogue.

## Safety

Unknown prices remain unknown; no default costs, provider limits, or pricing rows are seeded. No provider call, policy write, live migration, deploy, agent installation, or mission unfreeze is performed.
