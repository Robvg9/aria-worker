# OmniRoute Phase 13 — Negative Failure Certification v1.0.0

## Objective
Prove that invalid, unavailable, unauthorized and failed conditions can never become false success.

## Required negatives
- non-loopback gateway
- non-allowlisted provider
- raw credential / invalid credential reference
- route not explicitly allowed
- target/evidence mismatch
- rate limit without explicit fallback policy
- unknown quota
- open circuit
- terminal mission checkpoint
- unverified recovery health
- provider HTTP 503
- canonical security rejection

## Gate
Every tested negative remains blocked/failed/no_fallback and never `succeeded`.