# ARIA Voice V4 — command lanes and safety boundary

This module is a pure policy boundary. It is not yet wired to the production PWA API, Android service, Windows agent, or Supabase.

## Three separate lanes

| Lane | Allowed work | Safety |
| --- | --- | --- |
| \`read\` | \`aria.status\`, \`device.status\` | Authenticated owner session; never invokes a mutating executor |
| \`device.action\` | Allowlisted local actions only | Fresh signed owner session plus local speaker verification, capability grant, trusted/healthy explicit device target, expiry and shared idempotency |
| \`mission.execute\` | Mission start requests | Hard-blocked while the global mission freeze is active; even when thawed this contract only returns a confirmation-required state |

## Initial allowlist

- \`display.brightness.set\`: integer 0–100, capability \`display.brightness.write\`, low risk.
- \`app.open\`: pre-approved app IDs only, capability \`app.open\`, low risk.
- \`browser.open_url\`: HTTPS URL and an explicitly configured approved host, capability \`browser.open_url\`, medium risk.
- \`message.send\`: never sent from a voice command alone. The router returns a visible authenticated UI confirmation preview for the recipient and complete body; it never calls a message executor.

Raw shell, PowerShell, arbitrary code, file mutations, payment, purchase, delete, contacts discovery, and mission job creation are not available on the direct device-action lane.

## Trust boundaries

Production integration must inject:
- `authenticatedOwnerId` from the API's already-validated login session. It is mandatory when constructing the router; never accept it from the voice transcript or request body.
- the Ed25519 `createOwnerSessionVerifier` from `owner-session-verifier.js`, bound to a trusted per-device public key and the authenticated owner ID;
- an atomic, shared nonce store (`consume`) so signed owner sessions cannot be replayed on Android and multiple PCs;
- a server-controlled speaker policy that pins the approved model ID and minimum score. The client's `speaker_verified` and score fields are meaningful only inside a valid signature from the registered device key.
- an authorization provider for the capability grant;
- a device registry lookup returning current health, trusted security posture and exact capabilities;
- a shared atomic idempotency store spanning Android and PCs;
- a fixed operation adapter that maps structured parameters to native APIs, never a shell string.

A boolean supplied by an untrusted client is not a speaker proof. The signed-session module checks the Ed25519 signature, registered device ownership/trust/health, owner match, request/device binding, 30-second TTL and one-time nonce. The module is still NOT WIRED to the production API, device registry or durable nonce table. No speaker model is accepted for Cuban Spanish yet. A signature proves that the enrolled device asserted its local result; it does not make the speaker model immune to replay/deepfake. Messaging always needs separate visible confirmation.

## Operational invariant

The direct device-action lane does not import or call the mission dispatcher and does not create a mission ID, job ID, scheduler item or queue record. \`mission.execute\` is handled separately and must remain blocked during the current freeze.

## Required production gates

1. Persist and cryptographically verify the owner session; implement local enrollment, encrypted template storage, replay resistance and owner-controlled erase/reset.
2. Implement Android \`VoiceInteractionService\` or a compliant user-started microphone foreground service, with persistent status and an immediate stop control.
3. Implement a Windows per-user resident listener with explicit mic permissions and a small, dedicated local KWS model; benchmark on real target hardware before autostart.
4. Add action adapters for brightness/app/browser with post-action observation, multi-device arbitration and durable atomic idempotency.
5. Add a two-stage message draft/visible confirmation/send path. No voice-only message send.
6. Keep PWA foreground mode as fallback UI. Do not describe it as always-on.
7. Run the one final physical acceptance round on Android, RobVG and LaCueva only after code, tests and exact-SHA deploy are complete.


## Current production-port review — 2026-11-02

The Deno implementation in PR #1382 now ports these rules into the authenticated API, with a separate owner-session verifier, durable one-time nonce and idempotency stores, exact device targeting, and `voice_device_commands` separate from `execution_jobs`. The owner API exposes device-key register/revoke and approved speaker-model list, explicit-consent policy activation, and speaker-policy revocation. The minimum speaker score is read from the server-approved model catalog and cannot be lowered by the client.

Status is still OPEN / DRAFT and NOT LIVE. The new migration is unapplied, the production API and gateway do not yet include these routes, no model is approved for Cuban Spanish, and the resident Android/Windows listeners are not implemented. The reference file `voice-v4/command-router.js` remains a pure contract; the Deno port is a separate implementation under review. No raw audio, transcript, voiceprint or private key is stored in Supabase.


A speaker model is eligible only when its server catalog status is `approved`, its evaluation evidence and approval timestamp are present, and `supported_languages` includes `es-CU`. This gate is repeated at policy resolution and every direct-command queue lifecycle stage; generic Spanish, English, Chinese or synthetic-only models cannot be substituted for Cuban Spanish approval.


## Single-owner device pairing

The trusted Ed25519 registry enforces one owner per physical device ID. A device token cannot be used to add a second owner row while an earlier owner pairing exists. Owner transfer requires the current owner to revoke the pairing before the next authenticated owner registers the device.
