#!/usr/bin/env bash
set -euo pipefail
trap 'rm -f .aria-autonomy-secrets.json' EXIT
python .github/scripts/mission-wonder-2-step3-a3-prepare-deploy-secrets.py
wrangler deploy --config wrangler.aria-autonomy.toml --secrets-file .aria-autonomy-secrets.json
echo "ARIA_MW2_A3_COORDINATOR_DEPLOY=PASS"
