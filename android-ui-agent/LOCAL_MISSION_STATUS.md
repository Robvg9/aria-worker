# ARIA Android — Local Mission Runner (v1.1.2)

## Architecture

```
MainActivity (visible UI)
    → owner starts mission
    → Observe (no approval needed)
    → Propose action → PENDING_APPROVAL
    → Owner APPROVES or REJECTS
    → LocalMissionRunner executes via AriaAccessibilityService
    → post-observe + LocalEvidence (chain hash)
    → COMPLETE / FAILED / CANCELLED
```

## What was reused (not rewritten)

- `AriaAccessibilityService` observe / click / type / press / scroll / wait / navigate
- existing SHA-256 evidence hashes inside the service
- approved-browser restrictions

## What was added

| File | Role |
|------|------|
| `LocalModels.kt` | LocalMission, LocalStep, LocalObservation, LocalAction, LocalEvidence |
| `LocalMissionStore.kt` | durable JSON persistence + chainHash |
| `LocalMissionRunner.kt` | state machine + recover (never auto-execute) |
| `MainActivity.kt` | visible Approve / Reject / Cancel / Observe |
| unit tests | models, chain hash, recovery rules |

## What was retired as primary path

- `CommandReceiver` now always returns `broadcast_path_disabled`
- Termux `<queries>` removed from AndroidManifest
- No silent remote / am broadcast UI control

## Recovery contract

On app restart:
- PENDING_APPROVAL stays PENDING_APPROVAL
- approved-but-not-executed → forced back to PENDING_APPROVAL
- never auto-runs an action

## Version

- versionCode 8
- versionName 1.1.2

## Physical validation still required

tests (JVM unit) → assemble → install on device → enable Accessibility → full mission cycle with real Approve → evidence → Cancel

## Fase 7 — Diagnóstico Android real visible (v1.1.2)

Cuando Observe falla con `no_active_browser_window`, MainActivity muestra un panel legible con:

- activePackage, activeIsBrowser
- installedApprovedBrowsers
- windowsNull, windowCount
- applicationWindowCount, applicationWindowsWithRoot
- hint
- por cada ventana: type, layer, id, isActive, isFocused, hasRoot, packageName, isApprovedBrowser

El JSON completo se persiste en `LocalObservation.diagnosticJson`.
La lógica del resolver **no** se modificó en esta fase.
