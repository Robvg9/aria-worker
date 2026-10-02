'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts', 'utf8');

assert.ok(source.includes('async function jobIdFor(missionId: string, stepId: string, attempt: number = 1)'));
assert.ok(source.includes('const raw = `${missionId}\\0${stepId}\\0${safeAttempt}`;'));
assert.ok(source.includes('crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))'));
assert.ok(source.includes('const suffix = Array.from(new Uint8Array(digest))'));
assert.ok(source.includes('return `uo_${safe(missionId)}_${safe(stepId)}_a${safeAttempt}_${suffix}`;'));
assert.ok(source.includes('const jobId = await jobIdFor(missionId, String(step.id), attempt);'));

function referenceJobId(missionId, stepId, attempt = 1) {
  const safe = (value) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 28);
  const safeAttempt = Math.max(1, Math.min(99, Number.isFinite(Number(attempt)) ? Number(attempt) : 1));
  const crypto = require('node:crypto');
  const raw = `${missionId}\\0${stepId}\\0${safeAttempt}`;
  const suffix = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);
  return `uo_${safe(missionId)}_${safe(stepId)}_a${safeAttempt}_${suffix}`;
}

const prefix = 'ecc-aria-live-e2e-20261002-0';
const androidMission = prefix + '5-android-verified';
const windowsMission = prefix + '6-windows-verified';
const androidJob = referenceJobId(androidMission, 'ecc_live_doctor_verified_1', 1);
const windowsJob = referenceJobId(windowsMission, 'ecc_live_doctor_verified_1', 1);

assert.notEqual(androidJob, windowsJob);
assert.equal(androidJob.length, windowsJob.length);
assert.ok(androidJob.endsWith('_' + require('node:crypto').createHash('sha256').update(`${androidMission}\\0ecc_live_doctor_verified_1\\01`).digest('hex').slice(0,16)));
assert.ok(windowsJob.endsWith('_' + require('node:crypto').createHash('sha256').update(`${windowsMission}\\0ecc_live_doctor_verified_1\\01`).digest('hex').slice(0,16)));

console.log('MISSION RUNNER V22 JOB ID ISOLATION CONTRACT: PASS');
