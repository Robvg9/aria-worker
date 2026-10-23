'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const legacyWorkflow = fs.readFileSync(path.join(root, '.github/workflows/aria-cloudflare-deploy.yml'), 'utf8');
const isolatedDeploy = fs.readFileSync(path.join(root, '.github/workflows/aria-autonomy-coordinator-deploy.yml'), 'utf8');
const cloudWorker = fs.readFileSync(path.join(root, 'cloudflare-autonomy/worker.mjs'), 'utf8');
const wrangler = fs.readFileSync(path.join(root, 'wrangler.aria-autonomy.toml'), 'utf8');

assert.match(legacyWorkflow, /paths-ignore:/);
assert.match(legacyWorkflow, /workflow_dispatch:/);
const autonomyOnlyPaths = [
  '.github/workflows/aria-cloudflare-deploy.yml',
  '.github/workflows/aria-autonomy-coordinator-deploy.yml',
  '.github/workflows/persistent-autonomy-v1-tests.yml',
  'Dockerfile.aria-coordinator',
  'autonomy/PERSISTENT_AUTONOMY_V1.md',
  'autonomy/ollama-persistent-adapter-v1.js',
  'autonomy/persistent-autonomy-v1.env.example',
  'autonomy/persistent-control-plane-v1.js',
  'autonomy/persistent-dashboard-v1.html',
  'autonomy/persistent-http-server-v1.js',
  'autonomy/persistent-notifications-v1.js',
  'autonomy/persistent-worker-bridge-v1.js',
  'autonomy/persistent-worker-coordinator-adapter-v1.js',
  'scripts/Start-ARIA-Persistent-Worker.ps1',
  'scripts/aria-persistent-autonomy-v1.js',
  'scripts/aria-persistent-coordinator-v1.js',
  'scripts/aria-persistent-windows-worker-v1.js',
  'tests/cloudflare-autonomy-worker.test.js',
  'tests/aria-autonomy-supabase-boundary.test.js',
  'tests/ollama-persistent-adapter-v1.test.js',
  'tests/persistent-control-plane-v1.test.js',
  'tests/persistent-http-server-v1.test.js',
  'tests/persistent-hybrid-e2e-v1.test.js',
  'tests/persistent-notifications-v1.test.js',
  'tests/persistent-worker-bridge-v1.test.js',
  'wrangler.aria-autonomy.toml'
];
for (const file of autonomyOnlyPaths) {
  assert.ok(legacyWorkflow.includes("- '" + file + "'") || (file.startsWith('cloudflare-autonomy/') && legacyWorkflow.includes("'cloudflare-autonomy/**'")), 'legacy production deploy must ignore ' + file);
}
assert.ok(legacyWorkflow.includes('SUPABASE_ACCESS_TOKEN'), 'legacy workflow remains explicitly identifiable as Supabase-coupled');
assert.doesNotMatch(isolatedDeploy, /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF|supabase secrets set|supabase\.co/i);
assert.doesNotMatch(cloudWorker, /SUPABASE_ACCESS_TOKEN|SUPABASE_PROJECT_REF|createSupabaseMissionRepository|supabase\.co/i);
assert.match(wrangler, /class_name = "AriaMissionStore"/);
assert.match(wrangler, /new_sqlite_classes = \["AriaMissionStore"\]/);
process.stdout.write('aria-autonomy-supabase-boundary: all tests passed\n');
