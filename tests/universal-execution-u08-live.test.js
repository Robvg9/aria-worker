'use strict';

const assert = require('node:assert/strict');

const BASE_URL = process.env.ARIA_LIVE_BASE_URL || 'https://aria.robvg9.workers.dev';
const SUPABASE_BASE_URL = process.env.ARIA_SUPABASE_BASE_URL || 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1';
const SECRET = process.env.ARIA_RUNTIME_SHARED_SECRET;
const GOAL = 'Show the current working directory and print ARIA_REAL_RUNTIME_OK';

if (!SECRET) {
  console.error('ARIA_RUNTIME_SHARED_SECRET is required in the environment');
  process.exit(2);
}

async function post(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SECRET}`
    },
    body: JSON.stringify(payload)
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { response, body };
}

async function main() {
  const intake = await post(`${BASE_URL}/mission`, { goal: GOAL });
  assert.equal(intake.response.ok, true, `mission intake HTTP ${intake.response.status}`);
  const missionId = intake.body?.mission?.mission_id || intake.body?.mission_id || null;
  assert.ok(missionId, 'mission_id missing from live intake response');

  const runner = await post(`${SUPABASE_BASE_URL}/aria-mission-runner-v4`, { mission_id: missionId });
  assert.equal(runner.response.ok, true, `mission runner HTTP ${runner.response.status}`);

  const runnerStatus = runner.body?.status || runner.body?.execution?.status || null;
  assert.equal(runnerStatus, 'succeeded', `live runner did not succeed: ${JSON.stringify(runner.body)}`);

  const mission = runner.body?.mission || null;
  assert.equal(mission?.status, 'succeeded', `mission terminal status is not succeeded: ${JSON.stringify(mission)}`);
  assert.match(mission?.last_stdout || '', /ARIA_REAL_RUNTIME_OK/);
  assert.equal(mission?.last_exit_code, 0);
  assert.equal(mission?.completed_steps, 2);
  assert.equal(mission?.next_action, null);

  console.log(`UO-8 LIVE E2E passed: mission=${missionId}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`UO-8 LIVE E2E error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
