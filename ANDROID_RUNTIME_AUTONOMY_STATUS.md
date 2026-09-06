# ARIA Android Runtime Autonomy v1

Status: IMPLEMENTATION COMPLETE FOR CLOUD-SIDE / REPOSITORY-SIDE CAPABILITIES; PHYSICAL BOOT VALIDATION PENDING.

## Target lifecycle

`Android boot → Termux boot launcher → ARIA supervisor → aria-agent → heartbeat → job claim → governed execution → result`

## Implemented

- Persistent supervisor with controlled restart loop.
- `termux-wake-lock` support.
- Local secret boundary via `~/.aria-agent.env`.
- Automatic fast-forward pull from `origin/main` before a supervised restart when enabled.
- Boot launcher under `agents/termux/boot/start-aria-agent`.
- Idempotent installer: `agents/termux/install-autostart.sh`.
- Stale-stop-marker cleanup on a new Android boot.
- Supervisor logs under the agent directory.
- Contract tests included in canonical `npm test`.
- No device token is stored in repository files.

## Verification

The canonical `ARIA npm test` workflow passes on the current `main` after the Android autonomy and Gemini provider changes.

Repository implementation is not equivalent to physical validation. The remaining validation is a real Android lifecycle test after reboot, including heartbeat recovery, job claim, command execution and reporting.

## Human Gate minimization

The preferred one-time activation path is Termux:Boot. Its official documentation requires the add-on to be installed and launched once, after which scripts placed under `~/.termux/boot/` are run at Android boot. A wake lock is recommended when persistent background execution is needed.

Alternative mechanisms such as external Android automation may be evaluated if Termux:Boot is unavailable on the device, but they should not be introduced unless the primary path fails.

## Safety

The cloud runtime cannot remotely install Android applications or grant Android OS background-start permissions. Those platform permissions are intentionally outside ARIA's authority boundary.
