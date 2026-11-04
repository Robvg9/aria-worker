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
