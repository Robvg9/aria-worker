#!/data/data/com.termux/files/usr/bin/bash
set -eu

AGENT_DIR="${ARIA_AGENT_DIR:-$HOME/aria-agent}"
ENV_FILE="${ARIA_AGENT_ENV_FILE:-$HOME/.aria-agent.env}"
AGENT_SCRIPT="$AGENT_DIR/agents/termux/aria-agent.js"
LOG_DIR="$AGENT_DIR/logs"
STOP_FILE="$HOME/.aria-agent.stop"
RESTART_DELAY_SEC="${ARIA_AGENT_RESTART_DELAY_SEC:-5}"

mkdir -p "$LOG_DIR"
chmod 700 "$AGENT_DIR" "$LOG_DIR" 2>/dev/null || true

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${ARIA_DEVICE_GATEWAY_URL:?ARIA_DEVICE_GATEWAY_URL is required}"
: "${ARIA_DEVICE_TOKEN:?ARIA_DEVICE_TOKEN is required}"
: "${ARIA_DEVICE_ID:?ARIA_DEVICE_ID is required}"

if [ ! -x "$(command -v node)" ]; then
  echo "[ARIA] node is required" >&2
  exit 127
fi

rm -f "$STOP_FILE"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

cleanup() {
  touch "$STOP_FILE"
  if command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock || true
  fi
}
trap cleanup INT TERM EXIT

cd "$AGENT_DIR"

while [ ! -f "$STOP_FILE" ]; do
  if [ "${ARIA_AGENT_AUTO_PULL:-true}" = "true" ] && git -C "$AGENT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$AGENT_DIR" pull --ff-only origin main >/dev/null 2>&1 || true
  fi

  if [ ! -f "$AGENT_SCRIPT" ]; then
    echo "[ARIA] agent script missing: $AGENT_SCRIPT" >&2
    sleep "$RESTART_DELAY_SEC"
    continue
  fi

  echo "[ARIA] supervisor starting agent $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  node "$AGENT_SCRIPT" >>"$LOG_DIR/agent.log" 2>&1 || true

  [ -f "$STOP_FILE" ] && break
  sleep "$RESTART_DELAY_SEC"
done
