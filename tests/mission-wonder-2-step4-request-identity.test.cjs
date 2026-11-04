'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (file) => fs.readFileSync(file, 'utf8');

test('same owner, request id, goal and project reuses the canonical mission', async () => {
  const { missionRequestIdentityMatchesV1 } = await import('../supabase/functions/_shared/mission-request-identity-v1.mjs');
  const mission = {
    mission_id: 'mission_existing',
    goal: '  Audit ARIA mission execution  ',
    metadata: {
      request_id: 'request-123',
      user_id: 'user-123',
      owner_user_id: 'user-123',
      project_id: 'aria',
    },
  };

  assert.equal(missionRequestIdentityMatchesV1({
    mission,
    request_id: 'request-123',
    user_id: 'user-123',
    goal: 'Audit ARIA mission execution',
    project_id: 'aria',
  }), true);
});

test('same request id with a different goal or project is rejected', async () => {
  const { missionRequestIdentityMatchesV1 } = await import('../supabase/functions/_shared/mission-request-identity-v1.mjs');
  const mission = {
    mission_id: 'mission_existing',
    goal: 'Audit ARIA mission execution',
    metadata: {
      request_id: 'request-123',
      user_id: 'user-123',
      owner_user_id: 'user-123',
      project_id: 'aria',
    },
  };

  const base = { mission, request_id: 'request-123', user_id: 'user-123' };
  assert.equal(missionRequestIdentityMatchesV1({ ...base, goal: 'Delete a different project', project_id: 'aria' }), false);
  assert.equal(missionRequestIdentityMatchesV1({ ...base, goal: 'Audit ARIA mission execution', project_id: 'battlecruiser' }), false);
});

test('request id replay rejects a different owner and malformed identity', async () => {
  const { missionRequestIdentityMatchesV1 } = await import('../supabase/functions/_shared/mission-request-identity-v1.mjs');
  const mission = {
    mission_id: 'mission_existing',
    goal: 'Audit ARIA mission execution',
    metadata: {
      request_id: 'request-123',
      user_id: 'user-123',
      owner_user_id: 'user-123',
      project_id: null,
    },
  };

  assert.equal(missionRequestIdentityMatchesV1({
    mission, request_id: 'request-123', user_id: 'other-user',
    goal: 'Audit ARIA mission execution', project_id: null,
  }), false);
  assert.equal(missionRequestIdentityMatchesV1({
    mission, request_id: 'different-request', user_id: 'user-123',
    goal: 'Audit ARIA mission execution', project_id: null,
  }), false);
  assert.equal(missionRequestIdentityMatchesV1({
    mission: null, request_id: 'request-123', user_id: 'user-123',
    goal: 'Audit ARIA mission execution', project_id: null,
  }), false);
});

test('legacy canonical rows remain replayable only when all available identity fields match', async () => {
  const { missionRequestIdentityMatchesV1 } = await import('../supabase/functions/_shared/mission-request-identity-v1.mjs');
  const mission = {
    mission_id: 'mission_legacy',
    goal: 'Audit ARIA mission execution',
    metadata: { request_id: 'request-legacy', user_id: 'user-legacy', project_id: null },
  };
  assert.equal(missionRequestIdentityMatchesV1({
    mission, request_id: 'request-legacy', user_id: 'user-legacy',
    goal: 'Audit ARIA mission execution', project_id: null,
  }), true);
  assert.equal(missionRequestIdentityMatchesV1({
    mission, request_id: 'request-legacy', user_id: 'user-legacy',
    goal: 'Changed goal', project_id: null,
  }), false);
});

test('App API validates request identity before idempotent replay and ambiguous recovery', () => {
  const source = read('supabase/functions/aria-app-api-v3/index.ts');
  assert.match(source, /missionRequestIdentityMatchesV1/);
  assert.match(source, /const MISSION_EXECUTION_PAUSED = true;/);

  const replay = source.indexOf('if (priorMission?.mission_id)');
  const replayGuard = source.indexOf('if (!matchesCanonicalMissionRequest(priorMission))', replay);
  const replayResponse = source.indexOf('acknowledgement_source: "canonical_request_idempotent_replay"', replay);
  assert.ok(replay >= 0 && replayGuard > replay && replayResponse > replayGuard,
    'preflight replay must verify exact identity before returning the existing mission');

  const recovery = source.indexOf('if (found?.mission_id)');
  const recoveryGuard = source.indexOf('if (!matchesCanonicalMissionRequest(found))', recovery);
  const recoveryAssign = source.indexOf('canonicalMission = found;', recovery);
  assert.ok(recovery >= 0 && recoveryGuard > recovery && recoveryAssign > recoveryGuard,
    'ambiguous acknowledgement recovery must verify exact identity before accepting the mission');
});


function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

test('PWA reuses a persisted request ID for the same owner, goal and project', async () => {
  const { getOrCreateMissionSubmissionRequestIdV1 } = await import('../pwa/src/mission-submission-request-v1.mjs');
  const storage = memoryStorage();
  let generated = 0;
  const input = {
    userId: 'user-123',
    goal: '  Inspect ARIA mission intake  ',
    projectId: null,
    storage,
    now: () => 1000,
    createRequestId: () => 'request-' + (++generated),
  };

  const first = await getOrCreateMissionSubmissionRequestIdV1(input);
  const retry = await getOrCreateMissionSubmissionRequestIdV1({ ...input, goal: 'Inspect ARIA mission intake' });
  assert.equal(first, 'request-1');
  assert.equal(retry, first);
  assert.equal(generated, 1);
});

test('PWA gives different request IDs to different owner, goal or project intents', async () => {
  const { getOrCreateMissionSubmissionRequestIdV1 } = await import('../pwa/src/mission-submission-request-v1.mjs');
  const storage = memoryStorage();
  let generated = 0;
  const base = {
    userId: 'user-123',
    goal: 'Inspect ARIA mission intake',
    projectId: null,
    storage,
    now: () => 2000,
    createRequestId: () => 'request-' + (++generated),
  };
  const first = await getOrCreateMissionSubmissionRequestIdV1(base);
  const otherOwner = await getOrCreateMissionSubmissionRequestIdV1({ ...base, userId: 'user-456' });
  const otherGoal = await getOrCreateMissionSubmissionRequestIdV1({ ...base, goal: 'Inspect another project' });
  const otherProject = await getOrCreateMissionSubmissionRequestIdV1({ ...base, projectId: 'aria' });
  assert.equal(new Set([first, otherOwner, otherGoal, otherProject]).size, 4);
});

test('PWA releases the pending request ID only after canonical acknowledgement', async () => {
  const {
    getOrCreateMissionSubmissionRequestIdV1,
    clearMissionSubmissionRequestIdV1,
  } = await import('../pwa/src/mission-submission-request-v1.mjs');
  const storage = memoryStorage();
  let generated = 0;
  const input = {
    userId: 'user-123', goal: 'Inspect ARIA mission intake', projectId: null,
    storage, now: () => 3000, createRequestId: () => 'request-' + (++generated),
  };
  const first = await getOrCreateMissionSubmissionRequestIdV1(input);
  await clearMissionSubmissionRequestIdV1(input);
  const nextIntent = await getOrCreateMissionSubmissionRequestIdV1(input);
  assert.equal(first, 'request-1');
  assert.equal(nextIntent, 'request-2');
});

test('PWA expires stale pending IDs and fails closed when storage is corrupt', async () => {
  const { getOrCreateMissionSubmissionRequestIdV1 } = await import('../pwa/src/mission-submission-request-v1.mjs');
  const storage = memoryStorage();
  let currentTime = 4000;
  let generated = 0;
  const input = {
    userId: 'user-123', goal: 'Inspect ARIA mission intake', projectId: null,
    storage, now: () => currentTime, createRequestId: () => 'request-' + (++generated),
  };
  const first = await getOrCreateMissionSubmissionRequestIdV1(input);
  currentTime += 24 * 60 * 60 * 1000 + 1;
  const refreshed = await getOrCreateMissionSubmissionRequestIdV1(input);
  assert.notEqual(refreshed, first);

  storage.setItem('aria.pwa.mission-request.v1:user-123', '{broken-json');
  await assert.rejects(
    () => getOrCreateMissionSubmissionRequestIdV1(input),
    /mission_request_storage_corrupt/,
  );
});

test('PWA mission submission sends and clears the persisted identity after acknowledgement', () => {
  const source = read('pwa/src/App.tsx');
  const requestIndex = source.indexOf('getOrCreateMissionSubmissionRequestIdV1({');
  const postIndex = source.indexOf("api('/missions', session.accessToken", requestIndex);
  const headerIndex = source.indexOf("'x-aria-request-id': missionRequestId", postIndex);
  const clearIndex = source.indexOf('clearMissionSubmissionRequestIdV1({', postIndex);
  const acknowledgedIndex = source.indexOf("if (!missionId) throw new Error('ARIA no confirmó la creación de la misión.')", postIndex);
  assert.ok(requestIndex > 0 && postIndex > requestIndex && headerIndex > postIndex);
  assert.ok(acknowledgedIndex > postIndex && clearIndex > acknowledgedIndex,
    'pending request ID must be retained until a canonical mission ID is confirmed');
});
