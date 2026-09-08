# ARIA Android Browser Bridge v1

Native Android transport for ARIA Computer Use. This bridge is intentionally isolated from the core runtime and must be explicitly enabled by the device owner.

## Design
- `AccessibilityService` reads the active UI tree and performs allowlisted actions.
- No credentials or page secrets are persisted by the bridge.
- Read-only actions are supported first: observe, navigate intent, click, type, press, scroll, select, wait.
- High-risk/destructive actions remain blocked until ARIA's existing approval gate authorizes them.
- The service is not enabled automatically; Android requires the user to enable accessibility access in Settings.

## Expo integration
The app uses an Expo config plugin to add the accessibility service to the Android manifest. A development build is required; Expo Go cannot include this native service.

## Runtime boundary
The JavaScript side talks to the native module through a narrow contract. The native service exposes a local command/event channel and never receives provider credentials.
