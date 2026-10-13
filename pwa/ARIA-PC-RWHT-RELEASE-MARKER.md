# ARIA PC Browser RWHT release marker

This documentation-only file intentionally triggers the canonical Worker/PWA production deploy workflows when the PC Browser RWHT harness changes, so the post-merge authenticated RWHT can certify a new exact `main` SHA.

It is not imported by the app and does not change runtime behavior. Any code change still requires the normal deploy gates and a fresh exact-SHA LIVE test.

Follow-up: catalog version/total checks in authenticated RWHT workflows must derive expected values from `pwa/src/testCatalog.ts`. Do not pin a historic version/count in a workflow; the exact-SHA LIVE HTML must match the catalog at the SHA being tested.

Production smoke hardening: deployment asset checks retry transient edge 404s for the manifest, JavaScript and CSS, but still fail unless each resource is actually returned. The intent is to absorb propagation delay, not loosen HTTP/content assertions.

2026-10-12 PC RWHT v1.4.5 repair: tokenize multi-class rows on real whitespace so nested Meditation details are reopened; restore each route then force a full document reload to reset same-route modal/SPA state before replay. Keep exact-SHA LIVE and root/route/action evidence reconciliation mandatory.

2026-10-12 PC RWHT v1.4.6 modal-safety follow-up: scope cleanup to visible modal/dialog surfaces and exact Cerrar/Close buttons; never search the page for cancel because mission labels can include CANCELADA. Cleanup runs after the canonical-route full reload and before Meditation detail rows are reopened.

2026-10-12 PC RWHT v1.5.0 strategy change: preserve the hydrated #meditation SPA for read-only mission/history/queue probes; close true modal/dialog surfaces in-place; reload only after real route drift; wait for the target dynamic control identity rather than unrelated static controls. Keep 503/network/console failures hard failures and exact-SHA root/route/action reconciliation mandatory.


2026-10-12 PC RWHT v1.5.1 regression fix: wait for real modal dismissal after clicking the explicit Cerrar/Close control; click the modal backdrop only as a scoped fallback; after recording a read-only action's effect, dismiss the resulting overlay before replaying the next row. Do not skip the failing action or downgrade errors. Exact-SHA LIVE artifact must prove zero failed controls and coherent counters.


2026-10-12 certification-chain correction: include the PC Browser release marker in Persistence + Recovery workflow triggers; PC Browser v1.5.1 certification requires a same-SHA Persistence + Recovery run before Web Push, ABSORB and final PC Browser audit.


2026-10-13 PC RWHT v1.5.2: LIVE artefact #11780722548 on SHA `475418507f7e19e59674782b26465bd79d393842` isolated one real failure: a nested read-only Meditation row click was intercepted by an open mission detail layer (`locator.click` timeout 7000 ms). Fix closes topmost dialog layers one at a time, waits for the exact layer handle to detach/stop intercepting pointer events, and fails explicitly if any blocker remains. Report now records `counter_reconciliation`; verified PASS requires route/action/root counts to agree. The latest run had 7/7 routes, authenticated=true, 58 verified, 8 blocked, 10 skipped, 1 failed; page/console errors 0 and no ARIA-origin failed responses. This was not a counter mismatch: testable=67 correctly equals 58 verified + 8 blocked + 1 failed, with 10 skipped excluded from the denominator.


2026-10-13 PC RWHT v1.5.3 correction after live artefact #11781791930 on merge SHA `f7622acd4b08bd3388ecc7f429f7d3164a87352d`: the run itself was green and counters reconciled (7/7 routes, 59 verified, 8 blocked, 10 skipped, 0 failed, `counter_reconciliation.passed=true`), but an evidence audit found that 10 of 11 read-only Meditation navigation actions had `effect_observed=false`. The runner was closing modal layers before measuring the UI delta, erasing the proof of the dialog it had just opened. v1.5.3 captures visible modal/dialog heading, text and button signature plus URL/title/control deltas before cleanup. Safe read-only Meditation clicks hard-fail with `read_only_action_no_visible_effect` when no visible change is observed; cleanup still runs before the next control. Do not close point 1 until exact-SHA LIVE v1.5.3 artifact shows every tested read-only navigation has a visible effect and counters reconcile.


2026-10-13 PC RWHT v1.5.4 coverage correction: live artifact #11782421781 passed v1.5.3 counters, but its screenshot showed native `.meditationMoreDetails` still collapsed, so nested Human Gates / verification-pending / blocked / queue / history / failed controls were not part of the initial snapshot. v1.5.4 opens the outer read-only Meditation details panel and all nested read-only `<details>` before `discoverInteractive`, so hidden controls are inventoried on the same authenticated route. Queue-priority buttons are explicitly classified `queue_order_mutation_requires_human_gate`; do not perform queue writes. Point 1 remains open pending exact-SHA LIVE v1.5.4 artifact with reconciled counters and explicit outcomes for all discovered nested controls.
