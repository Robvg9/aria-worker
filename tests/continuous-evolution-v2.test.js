'use strict';

const assert = require('node:assert/strict');
const { STAGES, ACTION_STAGES, fingerprint, createContinuousEvolutionV2 } = require('../autonomy/continuous-evolution-v2');

(async () => {
  assert.deepEqual(STAGES, ['observe','diagnose','research','plan','build','test','security','evaluate','promote','deploy','verify','learn']);
  assert.deepEqual([...ACTION_STAGES].sort(), ['build','deploy','promote']);
  assert.match(fingerprint({ a: 1 }), /^[a-f0-9]{64}$/);

  const seen = [];
  const stageFns = Object.fromEntries(STAGES.map(stage => [stage, async ({ stage: current, results }) => {
    seen.push(current);
    return { status: current === 'verify' || current === 'learn' ? 'completed' : 'succeeded', evidence: Object.keys(results) };
  }]));

  const autonomous = createContinuousEvolutionV2({ ...stageFns, requireApproval: false });
  const result = await autonomous.run({ goal: 'improve ARIA' });
  assert.equal(result.status, 'completed');
  assert.equal(result.stop_reason, 'verified');
  assert.deepEqual(seen, STAGES);
  assert.match(result.evidence_hash, /^[a-f0-9]{64}$/);

  const approvalBlocked = createContinuousEvolutionV2({ ...stageFns, requireApproval: true });
  const blocked = await approvalBlocked.run({ goal: 'promote a change' });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.stop_reason, 'stage_build');
  assert.equal(blocked.cycles[0].results.build.reason, 'human_approval_required');
  assert.equal(blocked.cycles[0].results.promote, undefined);

  const approved = await approvalBlocked.run({
    goal: 'promote a change',
    approvals: { build: true, promote: true, deploy: true }
  });
  assert.equal(approved.status, 'completed');
  assert.equal(approved.stop_reason, 'verified');

  const securityFailureFns = { ...stageFns, security: async () => ({ status: 'failed', reason: 'security_gate_failed' }) };
  const stopped = await createContinuousEvolutionV2({ ...securityFailureFns, requireApproval: false }).run({ goal: 'unsafe change' });
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.stop_reason, 'stage_security');
  assert.equal(stopped.cycles[0].results.promote, undefined);

  console.log('CONTINUOUS_EVOLUTION_V2=PASS — governed evolution, approval gates, fail-closed security, evidence fingerprint and bounded execution');
})().catch(error => { console.error(error); process.exitCode = 1; });
