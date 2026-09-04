'use strict';

const assert = require('node:assert/strict');

const BASE_URL = process.env.ARIA_LIVE_BASE_URL || 'https://aria.robvg9.workers.dev';
const SECRET = process.env.ARIA_RUNTIME_SHARED_SECRET;
const GOAL = 'Show the current working directory and print ARIA_REAL_RUNTIME_OK';
const POLL_MS = Number(process.env.ARIA_LIVE_POLL_MS || 5000);
const TIMEOUT_MS = Number(process.env.ARIA_LIVE_TIMEOUT_MS || 120000);

if (!SECRET) {
  console.error('ARIA_RUNTIME_SHARED_SECRET is required in the environment');
  process.exit(2);
}

async function request(path, payload) {
  const response = await fetch(`${BASE_URL}${path}`, {
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

function extractIds(body) {
  const missionId = body?.mission?.mission_id || body?.mission_id || null;
  const jobId = body?.execution?.job_id || body?.job_id || null;
  return { missionId, jobId };
}

async function main() {
  const started = await request('/mission', { goal: GOAL });
  assert.equal(started.response.ok, true, `mission intake HTTP ${started.response.status}`);

  const { missionId, jobId } = extractIds(started.body);
  assert.ok(missionId, 'mission_id missing from live intake response');
  assert.ok(jobId, 'job_id missing from live intake response');

  const deadline = Date.now() + TIMEOUT_MS;
  let last = null;

  while (Date.now() < deadline) {
    const polled = await request('/runtime', { action: 'get_job', job_id: jobId });
    assert.equal(polled.response.ok, true, `runtime poll HTTP ${polled.response.status}`);
    last = polled.body;

    const job = polled.body?.job || null;
    if (job?.status === 'succeeded') {
      assert.match(job.last_stdout || '', /ARIA_REAL_RUNTIME_OK/);
      console.log(`UO-8 LIVE E2E passed: mission=${missionId} job=${jobId}`);
      return;
    }
    if (job?.status === 'failed' || job?.status === 'cancelled' || job?.status === 'blocked') {
      console.error(`UO-8 LIVE E2E failed: terminal status=${job.status}`);
      console.error(JSON.stringify({ status: job.status, reason: job.reason, last_exit_code: job.last_exit_code }, null, 2));
      process.exit(1);
    }

    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }

  console.error('UO-8 LIVE E2E timed out');
  console.error(JSON.stringify({ mission_id: missionId, job_id: jobId, last }, null, 2));
  process.exit(1);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`UO-8 LIVE E2E error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main };
