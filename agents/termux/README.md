# ARIA Termux Agent

The Termux agent is the device-side worker for ARIA's governed `shell.execute` path.

## Zero-touch lifecycle

The files in this directory support a persistent, reboot-tolerant worker:

- `aria-agent.js` — polls the ARIA device gateway, claims governed jobs, executes `shell.execute`, and returns results.
- `start-agent.sh` — loads a local environment file, acquires a wake lock when available, optionally fast-forwards the local checkout from `origin/main`, supervises the agent, and restarts it after unexpected exits.
- `boot/start-aria-agent` — Termux:Boot launcher that starts the supervisor after Android boot.

## Local secret boundary

The device token is never stored in this repository. The supervisor reads these variables from a local file (default: `~/.aria-agent.env`):

- `ARIA_DEVICE_GATEWAY_URL`
- `ARIA_DEVICE_TOKEN`
- `ARIA_DEVICE_ID`

The local environment file should be readable only by the Termux user.

## One-time phone setup

Install and open the official Termux:Boot add-on once, create its `~/.termux/boot/` directory, and place `boot/start-aria-agent` there. Termux:Boot is designed to start scripts at Android boot; a wake lock can be used to reduce device sleep-related worker interruption.

Also exempt Termux from aggressive battery optimization on the device where Android exposes that control. These are device-level requirements and cannot be completed by the Cloudflare/Supabase runtime alone.

## Stop / resume

Create `~/.aria-agent.stop` before starting the supervisor to request a clean stop. Remove it and start the boot launcher again to resume. The supervisor itself does not print or persist the device token.
