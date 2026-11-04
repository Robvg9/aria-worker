'use strict';

const assert = require('node:assert/strict');
const nodeCrypto = require('node:crypto');
if (!globalThis.crypto) globalThis.crypto = nodeCrypto.webcrypto;
if (!globalThis.atob) globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');

const helper = require('../supabase/functions/_shared/mission-wonder-2-pwa-scope-v1.mjs');

const SECRET = 'mission-wonder-2-step3-test-runtime-secret'.padEnd(48, 'x');
const USER = 'a1c4d6e8-1234-4abc-8def-1234567890ab';
const REQUEST = 'b2c5d7e9-1234-4abc-8def-1234567890ab';
const SCOPE = 'c3d6e8f0-1234-4abc-8def-1234567890ab';
const MISSION = 'mission_mw2_pwa_1234567890abcdef1234567890abcdef';
const PROJECT = 'aria';
const GOAL = 'Revisa el estado del repositorio ARIA y resume evidencia de solo lectura.';
const ROUTES = [
  { provider_id: 'google', account_id: 'acct_google_gemini_free', model_id: 'google/gemini-3.5-flash-lite-direct' },
  { provider_id: 'openrouter', account_id: 'acct_openrouter_primary', model_id: 'nvidia/nemotron-3.5-lightning:free' }
];
const OPERATIONS = ['repo_read','tree_read','file_read','ref_read','pr_find','pr_read','pr_checks','main_workflow_runs','text_generation'];

function b64(value) { return Buffer.from(value).toString('base64url'); }
function issue(payload) {
  const payload_b64 = b64(JSON.stringify(payload));
  const signature_b64 = nodeCrypto.createHmac('sha256', SECRET).update(payload_b64).digest('base64url');
  return { token: payload_b64 + '.' + signature_b64, proof: { payload_b64, signature_b64 } };
}
function claims(now = Date.now()) {
  return {
    v: 1,
    purpose: 'mission_wonder_2_step3_pwa_scoped_mission_v1',
    scope_id: SCOPE,
    user_id: USER,
    project_id: PROJECT,
    request_id: REQUEST,
    mission_id: MISSION,
    goal_sha256: nodeCrypto.createHash('sha256').update(GOAL.trim()).digest('hex'),
    issued_at: new Date(now - 1000).toISOString(),
    expires_at: new Date(now + 14 * 60 * 1000).toISOString(),
    max_steps: 4,
    max_attempts: 2,
    allowed_operations: OPERATIONS,
    allowed_model_routes: ROUTES
  };
}

(async () => {
  const now = Date.now();
  const issued = issue(claims(now));
  const verified = await helper.verifyMissionWonder2PwaScopeToken(
    issued.token, SECRET,
    { user_id: USER, project_id: PROJECT, request_id: REQUEST, mission_id: MISSION, goal_sha256: claims(now).goal_sha256 },
    { now }
  );
  assert.equal(verified.ok, true, verified.reason);
  const proofVerified = await helper.verifyMissionWonder2PwaScopeProof(
    issued.proof, SECRET,
    { user_id: USER, project_id: PROJECT, request_id: REQUEST, mission_id: MISSION, goal_sha256: claims(now).goal_sha256 },
    { now }
  );
  assert.equal(proofVerified.ok, true, proofVerified.reason);

  const wrongUser = await helper.verifyMissionWonder2PwaScopeProof(issued.proof, SECRET, { user_id: 'd4e7f901-1234-4abc-8def-1234567890ab' }, { now });
  assert.equal(wrongUser.ok, false);
  assert.match(wrongUser.reason, /binding_mismatch:user_id/);

  const wrongGoal = await helper.verifyMissionWonder2PwaScopeProof(issued.proof, SECRET, { goal_sha256: '0'.repeat(64) }, { now });
  assert.equal(wrongGoal.ok, false);
  assert.match(wrongGoal.reason, /binding_mismatch:goal_sha256/);

  const tampered = issue({ ...claims(now), project_id: 'battlecruiser' }).proof;
  const invalidSignature = await helper.verifyMissionWonder2PwaScopeProof(
    { ...tampered, signature_b64: issued.proof.signature_b64 }, SECRET, {}, { now }
  );
  assert.equal(invalidSignature.ok, false);
  assert.equal(invalidSignature.reason, 'scope_signature_invalid');

  const expired = issue({ ...claims(now), expires_at: new Date(now - 100).toISOString() });
  const expiredResult = await helper.verifyMissionWonder2PwaScopeProof(expired.proof, SECRET, {}, { now });
  assert.equal(expiredResult.ok, false);
  assert.equal(expiredResult.reason, 'scope_expired');
  const expiredReplay = await helper.verifyMissionWonder2PwaScopeProof(expired.proof, SECRET, {}, { now, allowExpired: true });
  assert.equal(expiredReplay.ok, true);
  assert.equal(expiredReplay.expired, true);

  const longTtl = issue({ ...claims(now), expires_at: new Date(now + 16 * 60 * 1000).toISOString() });
  assert.equal((await helper.verifyMissionWonder2PwaScopeProof(longTtl.proof, SECRET, {}, { now })).reason, 'scope_time_bounds_invalid');

  const goodModelStep = {
    id: 'summarize',
    executor_type: 'model',
    operation: 'text_generation',
    risk: 'READ',
    target: { type: 'model', provider_id: 'google', account_id: 'acct_google_gemini_free', model_id: 'google/gemini-3.5-flash-lite-direct' },
    input: { payload: { prompt: 'Summarize only the supplied read evidence.', max_tokens: 700 } },
    verify: { response_content_nonempty: true }
  };
  const goodGithubStep = {
    id: 'repo',
    executor_type: 'connector',
    operation: 'repo_read',
    risk: 'READ',
    target: { connector_id: 'github', repo: 'aria-worker' },
    input: { owner: 'Robvg9', repo: 'aria-worker' },
    verify: { response_content_nonempty: true }
  };
  assert.equal(helper.missionWonder2PwaScopeStepAllowed(claims(now), goodModelStep), true);
  assert.equal(helper.missionWonder2PwaScopeStepAllowed(claims(now), goodGithubStep), true);
  assert.equal(helper.missionWonder2PwaScopeStepAllowed(claims(now), { ...goodGithubStep, operation: 'file_write', risk: 'LOW_RISK_WRITE' }), false);
  assert.equal(helper.missionWonder2PwaScopeStepAllowed(claims(now), { ...goodGithubStep, executor_type: 'device', target: { type: 'device' } }), false);
  assert.equal(helper.missionWonder2PwaScopeStepAllowed(claims(now), { ...goodModelStep, target: { type:'model', provider_id:'ollama', account_id:'local', model_id:'qwen3:0.6b' } }), false);
  assert.equal(helper.missionWonder2PwaScopeStepAllowed(claims(now), { ...goodModelStep, input: { payload: { prompt:'x', max_tokens: 999999, tools: [{ name:'write' }] } } }), false);

  const planOk = helper.validateMissionWonder2PwaScopePlan(claims(now), [goodGithubStep, { ...goodModelStep, depends_on: ['repo'] }]);
  assert.equal(planOk.ok, true, planOk.reason);
  const tooMany = helper.validateMissionWonder2PwaScopePlan({ ...claims(now), max_steps: 1 }, [goodGithubStep, goodModelStep]);
  assert.equal(tooMany.ok, false);
  const unknownDependency = helper.validateMissionWonder2PwaScopePlan(claims(now), [{ ...goodGithubStep, depends_on: ['missing'] }]);
  assert.equal(unknownDependency.ok, false);
  const duplicateIds = helper.validateMissionWonder2PwaScopePlan(claims(now), [goodGithubStep, { ...goodModelStep, id: 'repo' }]);
  assert.equal(duplicateIds.ok, false);

  const mission = {
    mission_id: MISSION,
    goal: GOAL,
    metadata: {
      user_id: USER,
      project_id: PROJECT,
      request_id: REQUEST,
      mission_wonder_2_pwa_scope_proof: issued.proof,
      mission_wonder_2_pwa_scope_status: { status: 'active' }
    }
  };
  const missionVerified = await helper.verifyMissionWonder2PwaMission(mission, SECRET, { now });
  assert.equal(missionVerified.ok, true, missionVerified.reason);
  const revokedMission = {
    ...mission,
    metadata: { ...mission.metadata, mission_wonder_2_pwa_scope_status: { status: 'revoked' } }
  };
  const revoked = await helper.verifyMissionWonder2PwaMission(revokedMission, SECRET, { now });
  assert.equal(revoked.ok, false);
  assert.equal(revoked.reason, 'scope_not_active');

  process.stdout.write('MW2_STEP3_SCOPE_HMAC_BINDING=PASS\n');
  process.stdout.write('MW2_STEP3_SCOPE_TTL_AND_REPLAY_BOUNDS=PASS\n');
  process.stdout.write('MW2_STEP3_SCOPE_READ_ONLY_PLAN_ALLOWLIST=PASS\n');
  process.stdout.write('MW2_STEP3_SCOPE_OWNER_REQUEST_MISSION_GOAL_BINDING=PASS\n');
  process.stdout.write('MW2_STEP3_SCOPE_REVOCATION=PASS\n');
})().catch(error => {
  process.stderr.write(String(error && error.stack || error) + '\n');
  process.exitCode = 1;
});
