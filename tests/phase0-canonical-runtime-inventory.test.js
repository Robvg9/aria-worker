const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("phase 0 canonical runtime map is protected", () => {
  const worker = read("worker.js");
  assert.match(worker, /aria-app-api-v3/);
  assert.doesNotMatch(worker, /aria-app-api-v1/);
  assert.doesNotMatch(worker, /aria-app-api-v2/);

  const runner = read("supabase/functions/aria-mission-runner-v22/index.ts");
  assert.match(runner, /aria-planner-v11/);
  assert.match(runner, /aria-canonical-runtime-v1/);
  assert.match(runner, /aria-execution-runtime-v1/);
  assert.match(runner, /aria-runtime-gateway-v1/);

  const cloudflare = read(".github/workflows/aria-cloudflare-deploy.yml");
  assert.match(cloudflare, /paths:/);
  assert.match(cloudflare, /worker.js/);
  assert.match(cloudflare, /pwa/**/);

  const legacyActive = [
    ".github/workflows/apply-claim-source-instrument.yml",
    ".github/workflows/apply-capability-intent-planner.yml",
    ".github/workflows/patch-lease-batch-continue.yml",
    ".github/workflows/emergency-lease-fix.yml",
    ".github/workflows/verify-all-for-one-tick-once.yml",
    ".github/workflows/restore-stale-composition-wf.yml",
  ];
  for (const file of legacyActive) assert.equal(fs.existsSync(path.join(root, file)), false, file);

  const archived = [
    "docs/legacy-workflows/apply-claim-source-instrument.yml.disabled.yml",
    "docs/legacy-workflows/apply-capability-intent-planner.yml.disabled.yml",
    "docs/legacy-workflows/patch-lease-batch-continue.yml.disabled.yml",
    "docs/legacy-workflows/emergency-lease-fix.yml.disabled.yml",
    "docs/legacy-workflows/verify-all-for-one-tick-once.yml.disabled.yml",
  ];
  for (const file of archived) assert.equal(fs.existsSync(path.join(root, file)), true, file);
});
