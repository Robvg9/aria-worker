#!/usr/bin/env bash
set -euo pipefail

# Live browser suites must not race either of the two serialized production
# deployments for the same SHA. The Worker deploy can expose version.json
# before the PWA fast lane has finished propagating its static asset map.
if [[ "${GITHUB_EVENT_NAME:-}" == "pull_request" ]]; then
  echo "CLOUDFLARE_DEPLOY_BARRIER=SKIP_PULL_REQUEST"
  exit 0
fi

expected="${DEPLOY_EXPECTED_SHA:-${GITHUB_SHA}}"
repo="${GITHUB_REPOSITORY}"
api="${GITHUB_API_URL:-https://api.github.com}"
token="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
test -n "$token"
deadline=$((SECONDS + 720))
names=("Deploy ARIA Cloudflare Worker" "Deploy ARIA PWA Fast Lane")
declare -A done
for name in "${names[@]}"; do done["$name"]=false; done

while (( SECONDS < deadline )); do
  payload="$(curl --fail --silent --show-error --retry 2 --retry-delay 1 \
    -H "Authorization: Bearer $token" \
    -H "Accept: application/vnd.github+json" \
    "$api/repos/$repo/actions/runs?head_sha=$expected&per_page=100")"

  for name in "${names[@]}"; do
    state="$(jq -r --arg sha "$expected" --arg name "$name" '
      [.workflow_runs[] | select(.head_sha == $sha and .name == $name and .event == "push")]
      | sort_by(.created_at) | last
      | if . == null then "" else (.status + "|" + (.conclusion // "")) end
    ' <<<"$payload")"

    if [[ "$state" == "completed|success" ]]; then
      done["$name"]=true
      echo "CLOUDFLARE_DEPLOY_GATE_PASS name=$name sha=$expected"
    elif [[ "$state" == "completed|failure" || "$state" == "completed|cancelled" || "$state" == "completed|timed_out" ]]; then
      echo "::error::Cloudflare deployment gate failed: $name state=$state sha=$expected"
      exit 1
    else
      done["$name"]=false
      echo "CLOUDFLARE_DEPLOY_GATE_WAIT name=$name state=${state:-not_found} sha=$expected"
    fi
  done

  if [[ "${done[${names[0]}]}" == true && "${done[${names[1]}]}" == true ]]; then
    echo "CLOUDFLARE_DEPLOY_BARRIER_PASS sha=$expected"
    exit 0
  fi
  sleep 10
done

echo "::error::Timed out waiting for both exact-SHA Cloudflare deploy workflows: $expected"
exit 1
