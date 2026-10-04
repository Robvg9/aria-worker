# ARIA Proactive Signal Quality v1

## Canonical fingerprint
All new Proactive top-level fingerprints use `aria-proactive-fingerprint-v1.0.0`: canonical JSON serialization followed by lowercase SHA-256.

## Compatibility
Existing persisted fingerprints created before this phase are retained unchanged and are labeled `md5-legacy` when their known legacy form is MD5. They are never silently recomputed.

## Scope
This phase aligns Proactive Core, LIVE digest persistence, and LIVE Trend persistence on one declared fingerprint convention for new data.

## Safety
Fingerprint metadata is descriptive. It grants no authority to enqueue, execute, reroute, mutate missions/jobs, change provider/device state, or bypass permissions.
