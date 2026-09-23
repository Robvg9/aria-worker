#!/data/data/com.termux/files/usr/bin/bash
set -eu

AGENT_DIR="${ARIA_AGENT_DIR:-$HOME/aria-agent}"
BOOT_SRC="$AGENT_DIR/agents/termux/boot/start-aria-agent"
BOOT_DIR="$HOME/.termux/boot"
BOOT_DST="$BOOT_DIR/start-aria-agent"
ENV_FILE="${ARIA_AGENT_ENV_FILE:-$HOME/.aria-agent.env}"

if [ ! -f "$BOOT_SRC" ]; then
  echo "[ARIA] missing boot launcher: $BOOT_SRC" >&2
  exit 1
fi

mkdir -p "$BOOT_DIR"
chmod 700 "$BOOT_DIR" 2>/dev/null || true
cp "$BOOT_SRC" "$BOOT_DST"
chmod 700 "$BOOT_DST"

if [ -f "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE" 2>/dev/null || true
fi

# A clean install must not inherit a previous manual-stop marker.
rm -f "$HOME/.aria-agent.stop"

# Start the supervisor immediately so a fresh install does not depend on a reboot
# before the device can resume polling governed jobs. The supervisor lock makes
# this idempotent when an instance is already running.
LOG_DIR="$AGENT_DIR/logs"
mkdir -p "$LOG_DIR"
chmod 700 "$AGENT_DIR" "$LOG_DIR" 2>/dev/null || true
nohup "$AGENT_DIR/agents/termux/start-agent.sh" >>"$LOG_DIR/supervisor.log" 2>&1 < /dev/null &
SUPERVISOR_PID=$!

cat <<EOF
[ARIA] Android autostart installed.
[ARIA] Boot launcher: ~/.termux/boot/start-aria-agent
[ARIA] Environment: ~/.aria-agent.env
[ARIA] Supervisor launch requested now pid=$SUPERVISOR_PID
[ARIA] Verify ONLINE and a governed job is claimed; reboot Android once to verify boot persistence.
EOF
