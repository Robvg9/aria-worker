# ARIA Proactive Trend Intelligence v1

## Purpose
Convert persisted Proactive Intelligence digests into deterministic history signals that identify recurring and persistent recommendations.

## Boundary
Trend Intelligence is read-only and informational. It does not change mission state, job lifecycle, routing, provider availability, device control, scheduling, or permissions.

The only supported action mode is `recommendation_only`.

## Input
Each input digest may provide `digest_id`, `observed_at` or `generated_at`, and recommendations either at `recommendations[]` or `digest.recommendations[]`. Recommendation identity uses `kind`, `fingerprint`, and `id`.

## States
- `new`: observed once in the configured window;
- `recurring`: observed at least twice;
- `persistent`: observed at or above the configured minimum occurrence count.

## Safety
- invalid timestamps are ignored;
- duplicate appearances inside the same digest count once;
- history is bounded by a configurable window;
- trend identity is deterministic;
- missing fields remain unknown rather than becoming invented facts.

## Determinism
Identical input digests plus identical `options.now` produce identical trend IDs, ordering and overall fingerprint.

## Operational boundary
V1 is a trend-analysis layer over persisted Proactive digests. It creates no authority to act on trends.
