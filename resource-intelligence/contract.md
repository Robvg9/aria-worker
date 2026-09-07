# ARIA Resource / Cost Intelligence 1.0 — Contract

## Purpose
Turn task planning into a governed economic decision without granting execution authority.

## Decision pipeline
`task -> complexity -> requirements -> candidates -> token estimate -> latency estimate -> compute estimate -> risk -> expected value -> utility -> selection`

## Required task input
- `task`: non-empty string
- optional `complexity` in `low|medium|high|critical`
- optional `requirements`: capability/model/provider constraints
- optional `value` and `risk_tolerance`
- optional budgets: `max_cost_usd`, `max_tokens`, `max_latency_ms`

## Candidate input
Each candidate must provide:
- `provider_id`, `account_id`, `model_id`
- `quality_score` in [0,1]
- `cost_per_1k_input_usd` >= 0
- `cost_per_1k_output_usd` >= 0
- `latency_ms` > 0
- optional `compute_units` >= 0
- `risk_score` in [0,1]
- optional capability list

## Estimation
Token estimates are deterministic from task complexity and optional explicit token hints. No secret, credential, or network access is permitted.

## Utility rule
ARIA selects the **lowest-risk/cost candidate that is sufficiently good**, rather than blindly minimizing price. A candidate must satisfy capability constraints and the minimum quality threshold derived from task complexity and value.

A normalized utility score is produced only after hard budget/risk/latency constraints are applied. Unknown economics are preserved as `unknown` and cannot be treated as zero.

## Fail-closed rules
- Invalid task/candidate data -> no decision.
- Missing required economic dimensions -> candidate is not eligible unless the caller explicitly allows unknown economics; even then it cannot win against a fully known eligible candidate with sufficient quality.
- Any max budget breach -> excluded.
- Risk above tolerance -> excluded.
- Capability mismatch -> excluded.
- Equal utility -> deterministic lexical tie-break.
- No eligible candidate -> `no_resource`.

## Security boundary
This module is pure and secret-free. It does not execute models, access credentials, dispatch tools, or bypass Security 2.0. An eventual executor must re-check authorization independently.

## Output
`selected|no_resource|insufficient_evidence` with:
- selected candidate
- estimated tokens
- estimated latency
- estimated cost
- compute units
- risk
- expected value
- utility
- reason/evidence
- rejected candidates
- unknown dimensions

## Learning boundary
Only verified post-execution observations may be fed back to improve estimates. This contract never treats a prediction as an observation.
