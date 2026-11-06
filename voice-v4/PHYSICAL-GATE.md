# ARIA Voice V4 — single physical human gate (proposed)

Status: **PROPOSED, not executed.** This document defines one physical session for
RobVG, LaCueva and Android. It is not evidence by itself and must not be cited as
PASS until the evidence fields below are filled with real observations.

## Preconditions

- [ ] PR #1382 merged and the Supabase migrations applied by the canonical deploy.
- [ ] API and device-gateway versions recorded after the deploy.
- [ ] `ARIA_TELEGRAM_BOT_TOKEN` and `ARIA_TELEGRAM_OWNER_ID` configured if
      `message.send` is in scope.
- [ ] A speaker model approved for `es-CU` if `device.action` is in scope.
- [ ] Android APK installed from the reviewed build; record the build SHA and the
      APK signer certificate SHA-256.
- [ ] Windows agent on the reviewed commit and paired read-only.
- [ ] `MISSION_EXECUTION_PAUSED=true` during the whole session.
- [ ] One second speaker available for the non-owner check.

## Devices

| Slot | Device | Platform | Owner pairing |
| --- | --- | --- | --- |
| 1 | RobVG | Windows | read-only |
| 2 | LaCueva | Windows | read-only |
| 3 | Android | native app | read-only |

## Sequence (single session, about 20 minutes)

1. **Wake baseline.** At about 1 m, say “ARIA” three times per device, normal
   voice, no shouting. Record wake / no-wake per attempt.
2. **Confusables.** Say “María”, “área”, “haría” and “Oye María” twice each per
   device. None may activate.
3. **Non-owner.** The second speaker says “ARIA” three times per device. None may
   activate.
4. **Read lane.** Say “ARIA, dime el estado”. The answer must arrive within 5 s
   and must not execute anything (`executed=false`).
5. **Device action.** Say “ARIA, pon el brillo al cuarenta por ciento en
   <device>”. Exactly one execution; the target device reaches 40 %.
6. **Idempotency.** Repeat the same action within the command TTL. No second
   execution may occur.
7. **Message preview.** Say the Telegram message phrase. A visible preview must
   appear. Cancel once (nothing sent), then confirm once (single delivery).
8. **Freeze check.** Ask ARIA to start a mission. It must answer
   `mission_execution_paused` and create no job.
9. **Evidence capture.** Save command IDs, timestamps, screenshots or video, PWA
   console excerpt and Windows agent `VOICE COMMAND ACK` lines.

## Pass criteria (owner may adjust before the session)

- Wake: at least 2 of 3 attempts per device (6 of 9 total).
- False accepts: 0 of 6 confusables and 0 of 3 non-owner attempts.
- Read lane: 3 of 3 within 5 s.
- Device action: 3 of 3 with a single execution and the correct result.
- Idempotency: 0 duplicate executions.
- Freeze: 3 of 3 blocked.
- No transcript, audio, token or private key in logs or network responses.

## Evidence template

```
gate_started_utc:
gate_finished_utc:
worker_main_sha:
api_version:
gateway_version:
android_build_sha:
android_apk_signer_sha256:
windows_agent_sha:
wake_results:            RobVG __/3  LaCueva __/3  Android __/3
confusable_false_accepts: __/6
non_owner_false_accepts: __/3
read_lane_seconds:        __ / __ / __
device_action_command_ids:
duplicate_executions:    __
telegram_preview:        pass / fail / not_in_scope
freeze_blocked:          __/3
notes:
```

## Abort and rollback

Stop immediately if any of these happens: a command reaches an unintended device,
a mission job is created, a secret or raw audio appears in logs, or the owner
speaker is not the one who activated. Then revoke the trusted device keys, cancel
queued commands, redeploy the previous runtime and record the incident.
