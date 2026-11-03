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

This document describes the PWA contract only. It is **not** evidence that the Android/Windows native bridge exists or has passed physical certification. The current Android PR #6 is only a foreground PCM harness, and no Cuban-Spanish speaker model is approved. Direct actions remain unavailable until a native bridge and speaker evaluation satisfy the gates.
