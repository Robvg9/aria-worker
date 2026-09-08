# Android Browser Bridge v1 — Implementation Design

## Decision
Implement the Android transport as a native module/service rather than trying to extend Expo Go. Expo documentation states that Expo Go only supports native libraries included in the Expo SDK; custom native code requires a development build. Android's `AccessibilityService` requires an explicit user enablement and can observe/query the active window and act on UI elements.

## Components
1. `AriaBrowserBridgeModule` — Expo native module API exposed to the JS layer.
2. `AriaBrowserAccessibilityService` — Android `AccessibilityService` responsible for observation and bounded UI actions.
3. `AriaBrowserBridgeConfigPlugin` — adds the accessibility service declaration/configuration during Expo prebuild.
4. `BridgeStateStore` — in-memory/device-local state only; no credentials or browser cookies persisted.
5. JS adapter — translates native observations into `createUiState()` and native execution results into `createComputerRuntime()` adapter semantics.

## Native service scope
Supported browser packages MUST be explicitly allowlisted. Default allowlist is empty. The user/application configuration chooses the browser package. The service ignores unrelated applications.

## Observation contract
Return:
- `surface: "android-browser"`
- `package_name`
- `url` when exposed by accessibility content or explicitly supplied by the bridge
- `title`
- `focused_id`
- normalized nodes with `id`, `role`, `name`, `text`, `label`, `enabled`, `visible`, `parent_id`, and non-secret attributes

The bridge MUST never serialize passwords, auth tokens, cookies, API keys, private keys, or values matching the ARIA secret detector.

## Action contract
Accept only:
`navigate | click | type | press | scroll | select | wait`.

`click`, `type`, and `select` require an unambiguous target. `type` requires explicit text. High-risk/destructive actions are rejected unless the control plane provides an approved authorization object. The bridge itself cannot approve an action.

## Lifecycle states
`disconnected → ready → observing → executing → ready`; faults transition to `faulted` and require explicit recovery/rebind.

## Human Gate
The native service cannot be silently enabled. Android requires the user to explicitly enable an accessibility service in Settings. This remains the physical Human Gate for the transport layer.
