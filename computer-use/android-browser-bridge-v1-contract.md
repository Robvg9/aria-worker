# ARIA Android Browser Bridge v1 Contract

## Purpose
Provide a native Android transport between ARIA's existing `computer-use/runtime-v1` control plane and a real browser UI without changing the control-plane semantics.

## Boundary

The bridge is a transport adapter only. It MUST NOT decide mission intent, bypass approval, grant permissions, or execute provider/model logic.

```text
ARIA Computer Runtime
  -> Android Browser Bridge Adapter
  -> Device Dispatcher
  -> computer.use.android
  -> Termux Android agent
  -> 127.0.0.1:43817
  -> Android AccessibilityService
  -> Browser window
  -> UI observation
  -> verification
```

## Required capabilities
- Observe the active browser window and expose a deterministic UI state compatible with `createUiState()`.
- Locate elements by stable accessibility id/role/name/label/text/attributes when available.
- Execute the existing action vocabulary: `navigate`, `click`, `type`, `press`, `scroll`, `select`, `wait`.
- Return a terminal executor result: `succeeded`, `failed`, `blocked`, `cancelled`, or `verification_failed`.
- Re-observe after every action so the existing runtime can verify expectations and recover.
- Reject or redact secret-looking material before it crosses the bridge.
- Refuse `high_risk_write` and `destructive` actions in the governed adapter.

## Android-specific requirements
- Implement as a native Android `AccessibilityService`; Expo Go cannot provide this service to the JavaScript bundle.
- The Android service must be disabled by default until the user explicitly enables it in Android Accessibility settings.
- The service scopes interaction to an explicit browser package allowlist.
- The local bridge is bound to loopback and exposes only health, observe and action endpoints.
- UI state is normalized into immutable `ui-state-v1` nodes before entering the cognitive runtime.
- The native service redacts password-field content and rejects common raw-secret patterns.

## Secure RWHT credentials
- Persistent jobs contain only a reference such as `secret://rwht/rwht_android_password`; the secret value is never stored in `execution_jobs.command`.
- Android resolves the reference only immediately before the real UI type action.
- The dedicated resolver authenticates the registered Android device, verifies the live job is a governed `computer.use.android` job, requires an active credential whose scope includes RWHT, and returns the secret with `no-store` response semantics.
- The secret is used in memory for the local UI action and is not emitted to models, ChatBending, mission text, stdout or stderr.

## Security invariants
1. The bridge never stores provider credentials.
2. The bridge cannot approve its own high-risk or destructive actions.
3. Ambiguous element matches are blocked by `computer-use/runtime-v1`.
4. Destructive/high-risk actions fail closed in the governed adapter.
5. Browser UI observations are treated as untrusted external state.
6. Navigation must be re-observed before subsequent semantic actions.
7. Every executed action carries a mission id and deterministic action id for auditability.

## Compatibility with `computer-use/runtime-v1`
Adapter methods:
- `observe({ mission_id, recovery?, reason? }) -> UiState`
- `execute({ mission_id, action }) -> { status, ui?, reason?, metadata? }`

No new planning semantics are introduced. Existing `planAction`, `verifyObservation`, recovery bounds, learning bridge, and risk policy remain authoritative.

## Human Gate
The physical gate remains mandatory:
1. build a custom Android APK;
2. install it on the registered Android device;
3. explicitly enable the AccessibilityService;
4. open the approved browser;
5. perform a real observe -> action -> re-observe -> verification cycle;
6. persist evidence.

Backend/unit tests cannot substitute for this gate.
