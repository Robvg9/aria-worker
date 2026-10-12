# ARIA PC Browser RWHT release marker

This documentation-only file intentionally triggers the canonical Worker/PWA production deploy workflows when the PC Browser RWHT harness changes, so the post-merge authenticated RWHT can certify a new exact `main` SHA.

It is not imported by the app and does not change runtime behavior. Any code change still requires the normal deploy gates and a fresh exact-SHA LIVE test.

Follow-up: catalog version/total checks in authenticated RWHT workflows must derive expected values from `pwa/src/testCatalog.ts`. Do not pin a historic version/count in a workflow; the exact-SHA LIVE HTML must match the catalog at the SHA being tested.

Production smoke hardening: deployment asset checks retry transient edge 404s for the manifest, JavaScript and CSS, but still fail unless each resource is actually returned. The intent is to absorb propagation delay, not loosen HTTP/content assertions.

2026-10-12 PC RWHT evidence repair: reopen native Meditation `details` panels before rediscovering safe read-only mission/history rows after reload; keep full exact-SHA and action-counter verification mandatory.

2026-10-12 PC RWHT route-drift repair: restore the canonical route URL before replaying each control; never reload a URL changed by the previous safe navigation action. Keep dynamic-row details reopening and exact-SHA LIVE report reconciliation mandatory.
