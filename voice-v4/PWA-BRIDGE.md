# Voice V4 — PWA native signer bridge contract

The web PWA never stores or creates the private Ed25519 device key. The direct command client calls the optional host bridge:

`window.ariaVoiceV4.createOwnerSession(input)`

Input:
- `owner_id`: current authenticated Supabase user UUID, passed by the PWA.
- `request_id`: unique command UUID.
- `expires_at`: server-compatible Unix milliseconds, limited to 20 seconds by the PWA client.
- `operation`, `lane`, and `target_device_id`: the exact parsed action and destination; null target only for global read.

Output:
- `source_device_id`: the registered trusted source device ID.
- `owner_session`: the complete signed Voice V4 owner session `{ payload, signature }`.

The native implementation must:
1. Keep its Ed25519 private key in Android Keystore or Windows DPAPI-backed protected storage. Never expose it to JavaScript, localStorage, IndexedDB, logs, or network responses.
2. Bind the signature payload to the authenticated owner, source device, request ID, issued/expiry timestamps, nonce and session ID.
3. For `device.action`, return a signed speaker result only after a locally installed, owner-approved model has passed the server-pinned threshold. The server independently rechecks model approval, language `es-CU`, threshold, trusted-device state, expiry, nonce and signature.
4. Fail closed when pairing, key storage, secure clock, speaker policy or anti-replay state is unavailable.
5. Never sign a mission execution request while `MISSION_EXECUTION_PAUSED=true`.

The browser client supports explicit, narrow command phrases only (ARIA/device status, brightness, a small app alias list and HTTPS URL open). It requires an exact inventory match for the destination device. Other language remains ordinary conversation.

## Current implementation boundary (2026-11-03)

The PWA has a visible dashboard entry, **“Abrir modo voz”**, that opens the conversation screen with voice mode enabled. This is browser-based speech conversation and foreground hands-free recognition; it is not the native signing bridge. The PWA UI/test contract verifies that dashboard navigation and the explicit voice-mode toggle are present.

The Android companion app PR #6 now goes beyond the original PCM meter:
- It creates and retains an Ed25519 key in Android Keystore after an explicit user action.
- It calls the authenticated owner-pairing route to register the Android public key and a random pairing token. The matching SQL migration is not yet applied to Supabase LIVE, so this is not yet a live pairing capability.
- It implements the client path for a signed, short-lived `aria.status` request on the `read` lane and checks `executed=false`; an Android physical end-to-end run has not yet certified that path.
- Its Android pairing is forced to `read_only`, with empty capabilities and `wake_word_enabled=false`.
- It exposes an explicit server-side trust revocation action, followed by local SecureStore/Keystore cleanup.
- Its `PwaHostScreen` now injects `window.ariaVoiceV4.createOwnerSession` into the WebView, validates the exact HTTPS origin and checks the owner/device pairing heartbeat before allowing read-only signing.

The Android PWA host callback is implemented in code but not yet physically certified. Windows now has branch-only authenticated read-only pairing/heartbeat endpoints and separate DPAPI RPCs, but the helper still is not wired into `agents/windows/aria-agent.js`, and no secure Windows browser host, owner-token handoff, DPAPI token storage or physical pairing test exists. Do not treat either platform's code contracts as physical E2E evidence.

The Android app's APK builds currently use the Android Debug certificate unless a controlled release keystore and its approved `ANDROID_SIGNING_CERT_SHA256` fingerprint are configured. Such artifacts are QA-only, not production distributions.

This document describes the required PWA host bridge, not evidence that the Android/Windows bridge exists or has passed physical certification. No Cuban-Spanish speaker model has been approved for `es-CU`; direct/device actions remain gated. The mission pause remains active, and no physical microphone, wake-word or mission-execution path is enabled.


## Windows owner pairing backend contract — 2026-11-03

- The Worker branch now defines authenticated owner endpoints `POST /voice/devices/pair-windows` and `POST /voice/devices/heartbeat-windows`, backed by service-role-only RPCs `pair_voice_windows_owner_device` and `touch_voice_windows_owner_device`.
- The pairing identity is fixed to `aria-windows-dpapi-ed25519-v1`; it preserves the stable Windows agent device ID (for example, `windows-lacueva-...`) and stores the public-key fingerprint separately. The public key is the only signing-key material sent to the API; private key and device token remain DPAPI-protected.
- Pairing creates a `windows-native` trusted identity with empty capabilities, `wake_word_enabled=false`, and `mode=read_only`. Heartbeats preserve the empty capability set and cannot reactivate an administratively disabled device. Revocation uses the existing owner-scoped voice device revocation route.
- This is backend contract/code only. The Windows DPAPI key is still not wired into the agent or a browser host; there is no local HTTP bridge, no authenticated Windows owner-token handoff, no token persistence/enrollment UI, and no physical Windows pairing test. Do not claim Windows signing is ready to use.
- No migration is applied to Supabase LIVE. The endpoints become usable only after the governed migration/API release and after a separately reviewed native host securely handles the device token and authenticated owner session.
