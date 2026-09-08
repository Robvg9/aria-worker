# Android Browser Bridge v1 — Kotlin Skeleton Contract

The production implementation belongs in the Android app repository, not the JS-only ARIA worker. This file freezes the native surface before implementation.

Expected native classes:

```text
modules/aria-browser-bridge/
  android/src/main/java/.../AriaBrowserBridgeModule.kt
  android/src/main/java/.../AriaBrowserAccessibilityService.kt
  android/src/main/res/xml/aria_browser_accessibility_service.xml
  android/src/main/AndroidManifest.xml (or config-plugin generated equivalent)
```

Module events:
- `bridgeStateChanged`: `{state, timestamp}`
- `uiObserved`: `{uiState}`
- `actionResult`: `{actionId, status, reason?, ui?}`

Module methods:
- `getStatus()`
- `getUiState()`
- `executeAction(action)`
- `setAllowedBrowserPackages(packages)`
- `openAccessibilitySettings()`

The service must use `AccessibilityNodeInfo` for the active browser window, respect the configured package allowlist, avoid credentials/cookies, and emit only normalized safe UI state.
