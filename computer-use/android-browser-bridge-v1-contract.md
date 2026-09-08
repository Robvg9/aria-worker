# ARIA Android Browser Bridge v1 Contract

## Purpose
Provide a native Android transport between ARIA's existing `computer-use/runtime-v1` control plane and a real browser UI without changing the control-plane semantics.

## Boundary
The bridge is a transport adapter only. It MUST NOT decide mission intent, bypass approval, grant permissions, or execute provider/model logic.

```text
ARIA Computer Runtime
  -> Android Browser Bridge Adapter
  -> Android AccessibilityService
  -> Browser window
  -> UI observation
  -> verification
```

## Required capabilities
- Observe the active browser window and expose a deterministic UI state compatible with `createUiState()`.
- Locate elements by stable accessibility id/role/name/label/text/attributes when available.
- Execute only the existing action vocabulary: `navigate`, `click`, `type`, `press`, `scroll`, `select`, `wait`.
- Return a terminal executor result: `succeeded`, `failed`, `blocked`, `cancelled`, or `verification_failed`.
- Re-observe after every action so the existing runtime can verify expectations and recover.
- Reject or redact secret-looking material before it crosses the bridge.
- Refuse `high_risk_write` and `destructive` actions unless an explicit approval object is present and approved.

## Android-specific requirements
- Implement as a native Android `AccessibilityService`; Expo Go cannot provide this service to the JavaScript bundle.
- The Android service must be disabled by default until the user explicitly enables it in Android Accessibility settings.
- The service should scope interaction to browser package(s) explicitly registered by the user/system configuration.
- The bridge must expose a health/handshake endpoint or local binder contract so ARIA can distinguish `disconnected`, `ready`, `observing`, `executing`, and `faulted` states.
- UI state must be immutable at the runtime boundary and must not contain authentication tokens, cookies, passwords, API keys, private keys, or hidden credential material.

## Security invariants
1. The bridge never receives or stores provider credentials.
2. The bridge cannot approve its own actions.
3. Ambiguous element matches are blocked.
4. Destructive/high-risk actions are fail-closed without explicit approval.
5. Browser UI observations are treated as untrusted external state.
6. Navigation to a new origin is observable and must be re-verified before subsequent actions.
7. Every executed action carries a mission id and deterministic action id for auditability.

## Compatibility with `computer-use/runtime-v1`
Adapter methods:
- `observe({ mission_id, recovery?, reason? }) -> UiState`
- `execute({ mission_id, action }) -> { status, ui?, reason?, metadata? }`

No new planning semantics are introduced. Existing `planAction`, `verifyObservation`, recovery bounds, learning bridge, and risk policy remain authoritative.

## Human Gate
The only physical gate for this layer is enabling the Android AccessibilityService and performing one real browser navigation/action/verification cycle on a device. This gate cannot be simulated by backend tests.
