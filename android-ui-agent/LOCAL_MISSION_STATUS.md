# Local Mission Status

## Current (1.1.11 / versionCode 17)

- Package visibility: OK (`<queries>` for Chrome)
- Overlay OBSERVE (ACTION_DOWN): OK — Chrome stays active
- Propose after OBSERVE: OK
- Human Gate: OK
- **Browser handoff on APPROVE**: `BrowserHandoffExecutor`
  - Does **not** rely on `moveTaskToBack` alone (OEM may show launcher)
  - Uses launch Intent with `REORDER_TO_FRONT | RESET_TASK_IF_NEEDED | SINGLE_TOP | NEW_TASK`
  - Polls via existing `observe` until `com.android.chrome` is reported
  - On failure: `browser_handoff_failed` + diagnostic (not silent `post_action_window_missing`)
- Post-action observe: single observation from `actionResponse` (no duplicate)

## Files

- `BrowserHandoff.kt` — package selection + intent flags
- `BrowserHandoffExecutor.kt` — startActivity + observe poll
- `LocalMissionRunner.kt` — handoff before action; `failWithDiag`
- CI: restores `AriaAccessibilityService.kt` from commit `42b8e654` if PLACEHOLDER detected

## Physical test target

Chrome foreground → OBSERVE → PROPOSE → APPROVE → handoff → WAIT 500ms → POST-OBSERVE → EVIDENCE → COMPLETE
