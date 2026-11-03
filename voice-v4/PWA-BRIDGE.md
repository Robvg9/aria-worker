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
- Its code calls the authenticated owner-pairing route to register the Android public key and a random pairing token. The matching SQL migration is not yet applied to Supabase LIVE, so this is not yet a live pairing capability.
- It implements the client path for a signed, short-lived `aria.status` request on the `read` lane and checks `executed=false`; an Android physical end-to-end run has not yet certified that path.
- Its Android pairing is forced to `read_only`, with empty capabilities and `wake_word_enabled=false`.
- It exposes an explicit server-side trust revocation action, followed by local SecureStore/Keystore cleanup.

This native flow is inside the React Native app. It does **not** inject `window.ariaVoiceV4` into the separate web PWA and does not yet satisfy this document's browser-host bridge contract. The Windows DPAPI signing helper is also not yet integrated into `agents/windows/aria-agent.js`.

The Android app's APK builds currently use the Android Debug certificate unless a controlled release keystore and its approved `ANDROID_SIGNING_CERT_SHA256` fingerprint are configured. Such artifacts are QA-only, not production distributions.

This document describes the required PWA host bridge, not evidence that the Android/Windows bridge exists or has passed physical certification. No Cuban-Spanish speaker model has been approved for `es-CU`; direct/device actions remain gated. The mission pause remains active, and no physical microphone, wake-word or mission-execution path is enabled.
