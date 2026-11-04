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

test('PWA retains pending IDs until acknowledgement and fails closed when storage is corrupt', async () => {
  const { getOrCreateMissionSubmissionRequestIdV1 } = await import('../pwa/src/mission-submission-request-v1.mjs');
  const storage = memoryStorage();
  let currentTime = 4000;
  let generated = 0;
  const input = {
    userId: 'user-123', goal: 'Inspect ARIA mission intake', projectId: null,
    storage, now: () => currentTime, createRequestId: () => 'request-' + (++generated),
  };
  const first = await getOrCreateMissionSubmissionRequestIdV1(input);
  currentTime += 30 * 24 * 60 * 60 * 1000;
  const stillPending = await getOrCreateMissionSubmissionRequestIdV1(input);
  assert.equal(stillPending, first);
  assert.equal(generated, 1);

  storage.setItem('aria.pwa.mission-request.v1:pending', '{broken-json');
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


test('canonical mission create is atomic for concurrent owner/request retries', () => {
  const migration = read('supabase/migrations/20261104170000_aria_mission_request_identity_atomic_v1.sql');
  assert.match(migration, /create unique index if not exists mission_state_user_request_identity_uidx/i);
  assert.match(migration, /metadata\s*->>\s*'user_id'[\s\S]{0,180}metadata\s*->>\s*'request_id'/i);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(v_user_id\s*\|\|\s*':'\s*\|\|\s*v_request_id,\s*0\)\)/i);

  const lock = migration.indexOf('pg_advisory_xact_lock');
  const lookup = migration.indexOf("where metadata ->> 'user_id' = v_user_id", lock);
  const insert = migration.indexOf('insert into aria_internal.mission_state', lookup);
  assert.ok(lock >= 0 && lookup > lock && insert > lookup,
    'same request retries must serialize, reconcile the canonical row, then insert only when absent');

  assert.match(migration, /mission_request_idempotency_conflict/);
  assert.match(migration, /btrim\(coalesce\(existing\.goal, ''\)\) is distinct from btrim\(coalesce\(p_mission ->> 'goal', ''\)\)/i);
  assert.match(migration, /existing\.metadata ->> 'project_id'[\s\S]{0,120}v_project_id/i);
  assert.match(migration, /exception when unique_violation then[\s\S]*?return to_jsonb\(existing\)/i);
  assert.match(migration, /security definer[\s\S]*?set search_path to 'pg_catalog', 'aria_internal'/i);
  assert.doesNotMatch(migration, /MISSION_EXECUTION_PAUSED\s*=\s*false/i);
  assert.doesNotMatch(migration, /delete\s+from\s+aria_internal\.mission_state/i);
});

test('A4 deploy source keeps every canonical entry point frozen', () => {
  const direct = read('supabase/functions/aria-direct-v1/index.ts');
  const intake = read('supabase/functions/aria-mission-intake-v1/index.ts');
  const api = read('supabase/functions/aria-app-api-v3/index.ts');
  const runner = read('supabase/functions/aria-mission-runner-v22/index.ts');
  assert.match(api, /const MISSION_EXECUTION_PAUSED = true;/);
  assert.match(direct, /const MISSION_EXECUTION_PAUSED = true;/);
  assert.match(intake, /const MISSION_EXECUTION_PAUSED = true;/);
  assert.match(runner, /const MISSION_EXECUTION_PAUSED = true;/);
  assert.match(api, /mission_request_idempotency_conflict/);
  assert.match(api, /canonical_request_idempotent_replay/);
});


test('PWA coordinates concurrent tabs with Web Locks when the browser provides them', async () => {
  const { getOrCreateMissionSubmissionRequestIdV1 } = await import('../pwa/src/mission-submission-request-v1.mjs');
  const storage = memoryStorage();
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const activeLocks = new Map();
  let generated = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        async request(name, options, callback) {
          const prior = activeLocks.get(name) || Promise.resolve();
          let release;
          const queued = new Promise(resolve => { release = resolve; });
          activeLocks.set(name, prior.then(() => queued));
          await prior;
          try { return await callback(); }
          finally { release(); }
        }
      }
    }
  });
  try {
    const input = {
      userId: 'user-123', goal: 'Inspect ARIA mission intake', projectId: null,
      storage, now: () => 9000, createRequestId: () => 'request-' + (++generated),
    };
    const [first, concurrentRetry] = await Promise.all([
      getOrCreateMissionSubmissionRequestIdV1(input),
      getOrCreateMissionSubmissionRequestIdV1(input),
    ]);
    assert.equal(first, concurrentRetry);
    assert.equal(generated, 1);
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});


test('A4 preserves the canonical planner, lease, jobs, verification and PWA notification chain', () => {
  const runner = read('supabase/functions/aria-mission-runner-v22/index.ts');
  const verifier = read('supabase/functions/aria-smart-verifier-v1/index.ts');
  const canonical = read('supabase/functions/aria-canonical-runtime-v1/index.ts');
  const appApi = read('supabase/functions/aria-app-api-v3/index.ts');
  const pwa = read('pwa/src/App.tsx');
  const notificationSql = read('supabase/migrations/20260918113426_meditation_notifications_v1.sql');

  assert.match(canonical, /MISSION_EXECUTION_PAUSED\s*=\s*true/);
  assert.match(runner, /aria_mission_claim_by_id_lease/);
  assert.match(runner, /createPlan\(String\(mission\.goal\s*\|\|\s*""\)/);
  assert.match(runner, /SMART_VERIFIER/);
  assert.match(runner, /independentVerify\(mission, step, result\)/);
  assert.match(runner, /aria_mission_finalize_verified_lease/);
  assert.match(runner, /emitEvent\(missionId, "mission_verified"/);
  assert.match(runner, /from\(["']execution_jobs["']\)/);
  assert.match(verifier, /verification/);

  assert.match(appApi, /from\(["']mission_events["']\)/);
  assert.match(appApi, /meditationNotificationsForUser/);
  assert.match(pwa, /api\('\/missions\/' \+ encodeURIComponent\(id\) \+ '\/events'/);
  assert.match(pwa, /api\('\/meditation\/notifications\?limit=50'/);
  assert.match(pwa, /trackMission\(missionId\)/);
  assert.match(notificationSql, /after insert on aria_internal\.mission_events/i);
  assert.match(notificationSql, /on conflict \(source_event_id\) do nothing/i);
});
