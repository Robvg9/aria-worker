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
# before the device can resume polling governed jobs.
LOG_DIR="$AGENT_DIR/logs"
mkdir -p "$LOG_DIR"
chmod 700 "$AGENT_DIR" "$LOG_DIR" 2>/dev/null || true
chmod 700 "$AGENT_DIR/agents/termux/start-agent.sh" "$AGENT_DIR/agents/termux/boot/start-aria-agent" 2>/dev/null || true

# Replace a stale/already-running supervisor from an older installation.
# The supervisor may have a child Node process that keeps heartbeats alive even
# after the supervisor receives SIGTERM, so stop descendants before releasing
# the lock. Validate the command line before killing a PID from the lock file.
LOCK_DIR="${ARIA_AGENT_LOCK_DIR:-$HOME/.aria-agent.lock}"
LOCK_PID_FILE="$LOCK_DIR/pid"

kill_descendants() {
  local parent_pid="$1"
  local signal="$2"
  local children=""
  children="$(ps -A -o pid=,ppid= 2>/dev/null | awk -v p="$parent_pid" '$2==p {print $1}' || true)"
  for child_pid in $children; do
    kill_descendants "$child_pid" "$signal"
    kill -"$signal" "$child_pid" 2>/dev/null || true
  done
}

stop_existing_supervisor() {
  [ -f "$LOCK_PID_FILE" ] || return 0

  local old_pid=""
  old_pid="$(cat "$LOCK_PID_FILE" 2>/dev/null || true)"
  case "$old_pid" in
    ''|*[!0-9]*) rm -rf "$LOCK_DIR" 2>/dev/null || true; return 0 ;;
  esac

  if ! kill -0 "$old_pid" 2>/dev/null; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
    return 0
  fi

  local old_cmd=""
  old_cmd="$(tr '\0' ' ' < "/proc/$old_pid/cmdline" 2>/dev/null || true)"
  case "$old_cmd" in
    *"agents/termux/start-agent.sh"*) ;;
    *)
      echo "[ARIA] refusing to replace unrelated locked process pid=$old_pid" >&2
      return 1
      ;;
  esac

  echo "[ARIA] replacing existing supervisor pid=$old_pid"
  kill_descendants "$old_pid" TERM
  kill -TERM "$old_pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$old_pid" 2>/dev/null; then
      rm -rf "$LOCK_DIR" 2>/dev/null || true
      return 0
    fi
    sleep 0.25
  done

  kill_descendants "$old_pid" KILL
  kill -KILL "$old_pid" 2>/dev/null || true
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}

stop_existing_supervisor

# Termux can deny execve() of helper binaries from this app data path in
# some environments. Source the supervisor in a background subshell instead;
# this keeps the parent installer independent without requiring a second exec.
(
  . "$AGENT_DIR/agents/termux/start-agent.sh"
) >>"$LOG_DIR/supervisor.log" 2>&1 < /dev/null &
SUPERVISOR_PID=$!

cat <<EOF
[ARIA] Android autostart installed.
[ARIA] Boot launcher: ~/.termux/boot/start-aria-agent
[ARIA] Environment: ~/.aria-agent.env
[ARIA] Supervisor launch requested now pid=$SUPERVISOR_PID
[ARIA] Verify ONLINE and a governed job is claimed; reboot Android once to verify boot persistence.
EOF
