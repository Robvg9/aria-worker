# ARIA PC Browser RWHT release marker

This documentation-only file intentionally triggers the canonical Worker/PWA production deploy workflows when the PC Browser RWHT harness changes, so the post-merge authenticated RWHT can certify a new exact `main` SHA.

It is not imported by the app and does not change runtime behavior. Any code change still requires the normal deploy gates and a fresh exact-SHA LIVE test.

Follow-up: catalog version/total checks in authenticated RWHT workflows must derive expected values from `pwa/src/testCatalog.ts`. Do not pin a historic version/count in a workflow; the exact-SHA LIVE HTML must match the catalog at the SHA being tested.

Production smoke hardening: deployment asset checks retry transient edge 404s for the manifest, JavaScript and CSS, but still fail unless each resource is actually returned. The intent is to absorb propagation delay, not loosen HTTP/content assertions.

2026-10-12 PC RWHT v1.4.5 repair: tokenize multi-class rows on real whitespace so nested Meditation details are reopened; restore each route then force a full document reload to reset same-route modal/SPA state before replay. Keep exact-SHA LIVE and root/route/action evidence reconciliation mandatory.

2026-10-12 PC RWHT v1.4.6 modal-safety follow-up: scope cleanup to visible modal/dialog surfaces and exact Cerrar/Close buttons; never search the page for cancel because mission labels can include CANCELADA. Cleanup runs after the canonical-route full reload and before Meditation detail rows are reopened.
