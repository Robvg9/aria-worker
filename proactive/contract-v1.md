# ARIA Proactive Intelligence v1

## Purpose
Deterministic, read-only analysis of already-observed ARIA state into prioritized recommendations for attention.

## Boundary
Consumes snapshots from existing ARIA surfaces and emits informational recommendations. It does not own mission state, routing, provider selection, job lifecycle, or device control.

The only supported action mode is `recommendation_only`.

### Explicitly out of scope
- mission enqueueing or execution;
- execution-job claim/start/complete/recovery;
- Router or fallback changes;
- Meditation IA behavior;
- Android execution;
- OmniRoute behavior;
- network/database calls;
- Human Gate bypass.

## Snapshot inputs
Optional read-only sections:
- `devices[]`: id, status, active/queued work, heartbeat and evidence reference.
- `queue`: queued work plus optional eligible/online executor counts.
- `resources[]`: provider/model/capability/resource status plus evidence references.
- `evidence[]`: evidence id, observed time, verification state and max age.
- `runtime`: expected version and observed versions.
- `diagnostics[]`: diagnostic id, severity, status and correlation reference.

## Signals
v1 recognizes:
1. device attention when work is associated with an offline/stale device;
2. blocked queue when queued work has no evidenced eligible executor;
3. degraded/unavailable/blocked/failed resource;
4. verified evidence older than its declared freshness window;
5. runtime version drift;
6. unresolved error/critical diagnostics.

## Safety rules
- `unknown` remains `unknown`.
- Missing measurements are not treated as healthy.
- Historical evidence is not silently treated as current.
- Equivalent recommendations are deduplicated by deterministic fingerprint.
- Output never grants actuation authority.

## Determinism
Identical snapshot + identical `options.now` produces identical recommendations, ordering and fingerprints.

## Operational certification boundary
v1 core certification is code/contract/CI based. A future integration may feed real ARIA snapshots into this engine, but that consumer must retain the `recommendation_only` boundary and persist provenance separately.
