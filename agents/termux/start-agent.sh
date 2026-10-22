#!/data/data/com.termux/files/usr/bin/bash
set -eu

AGENT_DIR="${ARIA_AGENT_DIR:-$HOME/aria-agent}"
ENV_FILE="${ARIA_AGENT_ENV_FILE:-$HOME/.aria-agent.env}"
AGENT_SCRIPT="$AGENT_DIR/agents/termux/aria-agent.js"
LOG_DIR="$AGENT_DIR/logs"
STOP_FILE="$HOME/.aria-agent.stop"
RESTART_DELAY_SEC="${ARIA_AGENT_RESTART_DELAY_SEC:-5}"
STOPPING=0
LOCK_DIR="${ARIA_AGENT_LOCK_DIR:-$HOME/.aria-agent.lock}"

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    printf '%s\n' "${BASHPID:-$$}" > "$LOCK_DIR/pid"
    return 0
  fi
  local existing_pid=''
  if [ -f "$LOCK_DIR/pid" ]; then
    existing_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  fi
  case "$existing_pid" in
    ''|*[!0-9]*)
      echo "[ARIA] lock PID is missing or invalid; preserving lock for manual inspection" >&2
      exit 1
      ;;
  esac

  # PID numbers can be reused by Android. kill -0 alone does not prove that
  # the recorded process owns this supervisor lock.
  if kill -0 "$existing_pid" 2>/dev/null; then
    local existing_cmdline=''
    if [ -r "/proc/$existing_pid/cmdline" ]; then
      existing_cmdline="$(tr '\\000' ' ' < "/proc/$existing_pid/cmdline" 2>/dev/null || true)"
    elif command -v ps >/dev/null 2>&1; then
      existing_cmdline="$(ps -p "$existing_pid" -o args= 2>/dev/null || true)"
    else
      echo "[ARIA] cannot inspect lock PID $existing_pid; preserving lock" >&2
      exit 1
    fi

    case "$existing_cmdline" in
      *"$AGENT_SCRIPT"*)
        echo "[ARIA] supervisor already running pid=$existing_pid"
        exit 0
        ;;
      '')
        echo "[ARIA] lock PID $existing_pid is visible but its command line cannot be verified; preserving lock" >&2
        exit 1
        ;;
      *)
        echo "[ARIA] stale lock: PID $existing_pid is not this supervisor; attempting safe repair"
        ;;
    esac
  fi

  # Remove only the expected pid file, and only if no other lock contents
  # exist. Never recursively delete a lock directory that may hold state.
  if ! command -v find >/dev/null 2>&1; then
    echo "[ARIA] find unavailable; preserving lock for manual inspection" >&2
    exit 1
  fi
  local unexpected_entry=''
  unexpected_entry="$(find "$LOCK_DIR" -mindepth 1 -maxdepth 1 ! -name pid -print -quit 2>/dev/null || true)"
  if [ -n "$unexpected_entry" ]; then
    echo "[ARIA] lock contains unexpected entries; preserving directory: $unexpected_entry" >&2
    exit 1
  fi
  rm -f "$LOCK_DIR/pid" || { echo "[ARIA] could not remove stale PID file" >&2; exit 1; }
  rmdir "$LOCK_DIR" 2>/dev/null || { echo "[ARIA] could not safely remove stale lock directory" >&2; exit 1; }
  mkdir "$LOCK_DIR" 2>/dev/null || { echo "[ARIA] could not acquire supervisor lock" >&2; exit 1; }
  printf '%s\n' "${BASHPID:-$$}" > "$LOCK_DIR/pid"
}

release_lock() {
  if [ -f "$LOCK_DIR/pid" ] && [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "${BASHPID:-$$}" ]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
  fi
}

acquire_lock

mkdir -p "$LOG_DIR"
chmod 700 "$AGENT_DIR" "$LOG_DIR" 2>/dev/null || true

if [ -f "$ENV_FILE" ]; then
  chmod 600 "$ENV_FILE" 2>/dev/null || true
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${ARIA_DEVICE_GATEWAY_URL:?ARIA_DEVICE_GATEWAY_URL is required}"
: "${ARIA_DEVICE_TOKEN:?ARIA_DEVICE_TOKEN is required}"
: "${ARIA_DEVICE_ID:?ARIA_DEVICE_ID is required}"

if ! command -v node >/dev/null 2>&1; then
  echo "[ARIA] node is required" >&2
  exit 127
fi

unlock() {
  if command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock || true
  fi
}
stop() {
  STOPPING=1
}
# SIGTERM/SIGINT means “terminate this supervisor now”, not “persist a stop state”.
# The explicit stop mechanism remains the file $STOP_FILE; transient signals must
# never poison the next supervisor start and disable automatic recovery.
trap stop INT TERM
trap 'release_lock' EXIT
trap unlock EXIT

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

cd "$AGENT_DIR"

while [ "$STOPPING" -eq 0 ] && [ ! -f "$STOP_FILE" ]; do
  if [ "${ARIA_AGENT_AUTO_PULL:-true}" = "true" ] && git -C "$AGENT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    PULL_TIMEOUT_SEC="${ARIA_AGENT_GIT_PULL_TIMEOUT_SEC:-20}"
    case "$PULL_TIMEOUT_SEC" in
      ''|*[!0-9]*) PULL_TIMEOUT_SEC=20 ;;
    esac
    if [ "$PULL_TIMEOUT_SEC" -lt 5 ] || [ "$PULL_TIMEOUT_SEC" -gt 120 ]; then
      PULL_TIMEOUT_SEC=20
    fi

    if command -v timeout >/dev/null 2>&1; then
      if GIT_TERMINAL_PROMPT=0 timeout "${PULL_TIMEOUT_SEC}s" git -C "$AGENT_DIR" pull --ff-only origin main >/dev/null 2>&1; then
        :
      else
        echo "[ARIA] auto-pull failed or timed out; continuing with local checkout"
      fi
    else
      echo "[ARIA] timeout utility unavailable; skipping auto-pull to preserve agent availability"
    fi
  fi

  if [ ! -f "$AGENT_SCRIPT" ]; then
    echo "[ARIA] agent script missing: $AGENT_SCRIPT" >&2
    sleep "$RESTART_DELAY_SEC"
    continue
  fi

  echo "[ARIA] supervisor starting agent $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  node "$AGENT_SCRIPT" >>"$LOG_DIR/agent.log" 2>&1 || true

  [ "$STOPPING" -eq 1 ] && break
  [ -f "$STOP_FILE" ] && break
  sleep "$RESTART_DELAY_SEC"
done