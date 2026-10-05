# OmniRoute Registration / Rollback Runbook

## Current state
`omniroute.gateway` is a registration candidate only. `active=false` and `enablement=DISABLED` remain mandatory until LIVE/E2E and persistence gates pass.

## Promote
1. Verify source lock/version/provenance.
2. Verify Phase 7–14 receipts and negative certification.
3. Verify local gateway health and canonical LIVE/E2E.
4. Verify persistence/evidence after a real mission.
5. Review permissions and provider terms.
6. Change registration from PENDING_LIVE_E2E to REGISTERED.
7. Enable progressively behind explicit policy.
8. Run post-enable health and rollback smoke test.

## Rollback
1. Set `active=false` and remove OmniRoute from selectable capability availability.
2. Keep ARIA default/fallback routing available.
3. Stop accepting OmniRoute missions.
4. Preserve evidence and failure receipts.
5. Revert the implementation PR only when code-level rollback is required.
6. Record the incident and known regression.

## Evolution
New OmniRoute version → source lock → isolated audit → contract tests → negative tests → comparative evaluation → LIVE E2E → promotion or rejection.
Never replace a certified version without a new evidence chain.