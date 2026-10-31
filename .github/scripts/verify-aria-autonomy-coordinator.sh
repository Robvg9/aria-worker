#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${ARIA_AUTONOMY_BASE_URL:-https://aria-autonomy-coordinator.robvg9.workers.dev}"
ARIA_CONTROL_TOKEN="${ARIA_CONTROL_TOKEN:-}"
ARIA_WORKER_TOKEN="${ARIA_WORKER_TOKEN:-}"
RESPONSE_FILE="$(mktemp)"
trap 'rm -f "$RESPONSE_FILE"' EXIT

if [ "${#ARIA_CONTROL_TOKEN}" -lt 32 ] || [ "${#ARIA_WORKER_TOKEN}" -lt 32 ]; then
  echo "ARIA_AUTONOMY_VERIFY_TOKENS_INVALID=true" >&2
  exit 1
fi

health_ok=false
health_code="000"
for attempt in $(seq 1 12); do
  : > "$RESPONSE_FILE"
  health_code="$(curl --silent --show-error --max-time 10 \
    -o "$RESPONSE_FILE" -w '%{http_code}' "$BASE_URL/health" 2>/dev/null || true)"

  if [ "$health_code" = "200" ]; then
    if HEALTH="$(cat "$RESPONSE_FILE")" python - <<'PY' 2>/dev/null
import json, os
payload = json.loads(os.environ["HEALTH"])
assert payload.get("ok") is True
assert payload.get("service") == "aria-autonomy-coordinator"
assert payload.get("supabase_independent") is True
PY
    then
      health_ok=true
      echo "ARIA_AUTONOMY_LIVE_HEALTH_PASS=true"
      break
    fi
  fi

  echo "ARIA_AUTONOMY_HEALTH_RETRY attempt=$attempt/12 http_status=${health_code:-000}"
  if [ "$attempt" -lt 12 ]; then sleep 5; fi
done

if [ "$health_ok" != "true" ]; then
  echo "ARIA_AUTONOMY_LIVE_HEALTH_FAIL=true http_status=${health_code:-000}" >&2
  if [ -s "$RESPONSE_FILE" ]; then
    echo "ARIA_AUTONOMY_HEALTH_RESPONSE_BEGIN" >&2
    head -c 1500 "$RESPONSE_FILE" >&2
    echo >&2
    echo "ARIA_AUTONOMY_HEALTH_RESPONSE_END" >&2
  fi
  exit 1
fi

expect_status() {
  local label="$1"
  local expected="$2"
  shift 2
  : > "$RESPONSE_FILE"
  local actual
  actual="$(curl --silent --show-error --max-time 15 \
    -o "$RESPONSE_FILE" -w '%{http_code}' "$@" 2>/dev/null || true)"
  if [ "$actual" != "$expected" ]; then
    echo "ARIA_AUTONOMY_PROBE_FAIL name=$label expected=$expected actual=${actual:-000}" >&2
    if [ -s "$RESPONSE_FILE" ]; then
      head -c 1500 "$RESPONSE_FILE" >&2
      echo >&2
    fi
    exit 1
  fi
  echo "ARIA_AUTONOMY_PROBE_PASS name=$label http_status=$actual"
}

expect_status unauthenticated_read 401 "$BASE_URL/api/missions"
expect_status authenticated_read 200 "$BASE_URL/api/missions" \
  -H "Authorization: Bearer $ARIA_CONTROL_TOKEN"

# These probes are intentionally non-mutating even if the freeze regresses:
# malformed JSON fails before writes; fake IDs cannot match stored data.
expect_status create_rejected_while_frozen 423 "$BASE_URL/api/missions" \
  -X POST -H "Authorization: Bearer $ARIA_CONTROL_TOKEN" \
  -H 'content-type: application/json' --data-binary '{'
expect_status resume_rejected_while_frozen 423 "$BASE_URL/api/missions/freeze-probe/resume" \
  -X POST -H "Authorization: Bearer $ARIA_CONTROL_TOKEN" \
  -H 'content-type: application/json' --data-binary '{'
expect_status approval_rejected_while_frozen 423 "$BASE_URL/api/approvals/freeze-probe" \
  -X POST -H "Authorization: Bearer $ARIA_CONTROL_TOKEN" \
  -H 'content-type: application/json' --data-binary '{'
expect_status worker_claim_rejected_while_frozen 423 "$BASE_URL/api/worker/claim" \
  -X POST -H "Authorization: Bearer $ARIA_WORKER_TOKEN" \
  -H 'content-type: application/json' --data-binary '{'

echo "ARIA_AUTONOMY_LIVE_HEALTH_AUTH_AND_GLOBAL_FREEZE_PASS=true"
