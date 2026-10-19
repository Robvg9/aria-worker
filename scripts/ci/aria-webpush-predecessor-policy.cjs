'use strict';

const fs = require('node:fs');

const WEB_PUSH_WORKFLOW_NAME = 'ARIA Meditation IA — Production Web Push E2E';

// Keep this policy aligned with on.push.paths in
// .github/workflows/aria-meditation-webpush-production-e2e.yml.
// ABSORB covers additional changes (such as aria-device-gateway) that do not
// affect Web Push. Those releases must not wait 30 minutes for a workflow that
// GitHub correctly did not trigger.
const WEB_PUSH_TRIGGER_PATHS = Object.freeze([
  'rwht/pc-browser/rwht-meditation-pwa-e2e.mjs',
  'rwht/pc-browser/rwht-pc-browser.mjs',
  'tests/pc-rwht-browser.test.js',
  'rwht/pc-browser/cloudflare-live-webpush-physical-e2e.mjs',
  'pwa/src/notifications.ts',
  'pwa/public/sw.js',
  'pwa/**',
  'worker.js',
  'wrangler.toml',
  '.github/workflows/aria-cloudflare-deploy.yml',
  '.github/workflows/aria-pwa-fast-deploy.yml',
  '.github/workflows/aria-scheduler-transport-deploy.yml',
  'supabase/functions/aria-app-api-v3/**',
  'supabase/functions/aria-planner-v11/**',
  'supabase/functions/aria-mission-runner-v22/**',
  'supabase/functions/_shared/physical-execution-contract.mjs',
  'supabase/migrations/*meditation*',
  '.github/workflows/aria-meditation-webpush-production-e2e.yml',
  '.github/workflows/supabase-canonical-deploy.yml',
  '.github/workflows/e2e-human-gate-safe-autonomy.yml',
  '.github/workflows/persistence-recovery-rwht-authenticated.yml',
  '.github/workflows/pc-rwht.yml',
]);

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
}

function matchesTriggerPath(filePath, pattern) {
  return globToRegExp(pattern).test(filePath);
}

function collectChangedPaths(eventPayload) {
  const found = new Set();
  const commits = Array.isArray(eventPayload && eventPayload.commits) ? eventPayload.commits : [];

  for (const commit of commits) {
    for (const key of ['added', 'modified', 'removed']) {
      const paths = commit && commit[key];
      if (Array.isArray(paths)) {
        for (const item of paths) if (typeof item === 'string') found.add(item);
      }
    }
  }

  // GitHub includes head_commit on ordinary push payloads. Reading it as a
  // fallback also handles providers/payload variants where commits is empty.
  if (eventPayload && eventPayload.head_commit) {
    for (const key of ['added', 'modified', 'removed']) {
      const paths = eventPayload.head_commit[key];
      if (Array.isArray(paths)) {
        for (const item of paths) if (typeof item === 'string') found.add(item);
      }
    }
  }

  return [...found];
}

function webPushPredecessorDecision(eventPayload, eventName = 'push') {
  // A manual run lacks push changed-file metadata. Fail closed: retain the
  // predecessor for workflow_dispatch, and for any payload we cannot classify.
  if (eventName !== 'push') {
    return { required: true, reason: 'non-push-event-fail-closed', matchedPath: null };
  }

  const changedPaths = collectChangedPaths(eventPayload);
  if (changedPaths.length === 0) {
    return { required: true, reason: 'changed-paths-unavailable-fail-closed', matchedPath: null };
  }

  for (const filePath of changedPaths) {
    const matched = WEB_PUSH_TRIGGER_PATHS.find(pattern => matchesTriggerPath(filePath, pattern));
    if (matched) {
      return { required: true, reason: 'webpush-trigger-path', matchedPath: filePath };
    }
  }

  return { required: false, reason: 'no-webpush-trigger-path', matchedPath: null };
}

function main() {
  const eventFile = process.argv[2];
  if (!eventFile) {
    process.stderr.write('Usage: node aria-webpush-predecessor-policy.cjs <github-event-json>\n');
    process.exitCode = 2;
    return;
  }

  let eventPayload;
  try {
    eventPayload = JSON.parse(fs.readFileSync(eventFile, 'utf8'));
  } catch (error) {
    process.stderr.write('Unable to read GitHub event payload: ' + error.message + '\n');
    process.exitCode = 2;
    return;
  }

  const eventName = process.env.GITHUB_EVENT_NAME || 'push';
  const decision = webPushPredecessorDecision(eventPayload, eventName);
  const predecessor = decision.required ? WEB_PUSH_WORKFLOW_NAME : '';
  process.stdout.write('predecessor=' + predecessor + '\n');
  process.stdout.write('decision=' + decision.reason + '\n');
  if (decision.matchedPath) process.stdout.write('matched_path=' + decision.matchedPath + '\n');
}

if (require.main === module) main();

module.exports = {
  WEB_PUSH_WORKFLOW_NAME,
  WEB_PUSH_TRIGGER_PATHS,
  matchesTriggerPath,
  collectChangedPaths,
  webPushPredecessorDecision,
};
