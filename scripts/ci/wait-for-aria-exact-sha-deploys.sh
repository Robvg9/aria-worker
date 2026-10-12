#!/usr/bin/env bash
set -euo pipefail

expected_sha="${1:-${RWHT_CERT_SHA:-${GITHUB_SHA:-}}}"
repo="${GITHUB_REPOSITORY:-}"
token="${GH_TOKEN:-}"

if [[ ! "${expected_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Invalid/missing expected release SHA: ${expected_sha}"
  exit 2
fi
if [[ -z "${repo}" || -z "${token}" ]]; then
  echo "::error::GITHUB_REPOSITORY and GH_TOKEN are required to validate release deployment jobs"
  exit 2
fi

runs_url="https://api.github.com/repos/${repo}/actions/runs?head_sha=${expected_sha}&per_page=100"
worker_state="missing|"
pwa_state="missing|"

for attempt in $(seq 1 120); do
  runs_json="$(curl --fail --silent --show-error --max-time 20 \
    -H "Authorization: Bearer ${token}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${runs_url}")"

  deployment_states="$(RUNS_JSON="${runs_json}" EXPECTED_SHA="${expected_sha}" python - <<'PY'
import json
import os

data = json.loads(os.environ["RUNS_JSON"])
expected = os.environ["EXPECTED_SHA"]
required = ("Deploy ARIA Cloudflare Worker", "Deploy ARIA PWA Fast Lane")
valid_events = {"push", "workflow_dispatch"}

for name in required:
    matches = [
        run for run in data.get("workflow_runs", [])
        if run.get("name") == name
        and run.get("head_sha") == expected
        and run.get("head_branch") == "main"
        and run.get("event") in valid_events
    ]
    if not matches:
        print(name + "|missing|")
        continue
    latest = max(
        matches,
        key=lambda run: (run.get("created_at", ""), int(run.get("run_attempt", 1) or 1)),
    )
    print(
        name + "|"
        + str(latest.get("status") or "missing") + "|"
        + str(latest.get("conclusion") or "")
    )
PY
  )"

  worker_state="$(awk -F'|' '$1=="Deploy ARIA Cloudflare Worker"{print $2 "|" $3}' <<<"${deployment_states}")"
  pwa_state="$(awk -F'|' '$1=="Deploy ARIA PWA Fast Lane"{print $2 "|" $3}' <<<"${deployment_states}")"
  echo "EXACT_SHA_DEPLOY_STATES worker=${worker_state} pwa=${pwa_state} attempt=${attempt}"

  if [[ "${worker_state}" == "completed|success" && "${pwa_state}" == "completed|success" ]]; then
    echo "EXACT_SHA_PRODUCTION_DEPLOYS_PASS=${expected_sha}"
    exit 0
  fi

  if [[ "${worker_state}" == "completed|"* && "${worker_state}" != "completed|success" ]]; then
    echo "::error::Deploy ARIA Cloudflare Worker ended non-success on ${expected_sha}: ${worker_state}"
    exit 1
  fi
  if [[ "${pwa_state}" == "completed|"* && "${pwa_state}" != "completed|success" ]]; then
    echo "::error::Deploy ARIA PWA Fast Lane ended non-success on ${expected_sha}: ${pwa_state}"
    exit 1
  fi

  if [[ "${attempt}" -eq 120 ]]; then
    echo "::error::Timed out waiting for both exact-SHA production deploys (${expected_sha})"
    exit 1
  fi
  sleep 5
done
