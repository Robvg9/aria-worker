'use strict';

const assert = require('node:assert/strict');
const { createDesktopAutonomyLoop } = require('../autonomy/desktop-autonomy-loop');

let visionReads = 0;
let missionsRun = 0;
const loop = createDesktopAutonomyLoop({
  interval_ms: 10_000,
  readVision: async () => { visionReads += 1; return { goals: ['test'] }; },
  deriveMission: async () => ({ id: 'm1', objective: 'desktop smoke', risk: 'low' }),
  runMission: async ({ mission }) => { missionsRun += 1; return { status: 'succeeded', mission_id: mission.id }; },
  reflect: async ({ results }) => ({ status: results[0].status })
});

(async () => {
  const first = await loop.tick('test');
  assert.equal(first.status, 'completed');
  assert.equal(visionReads, 1);
  assert.equal(missionsRun, 1);
  assert.equal(first.missions[0].status, 'succeeded');
  assert.equal(loop.status().tick_count, 1);

  loop.stop();
  const skipped = await loop.tick('disabled');
  assert.equal(skipped.status, 'skipped');
  assert.equal(skipped.reason, 'disabled');

  loop.start();
  const busyPromise = loop.tick('busy-check');
  const second = await busyPromise;
  assert.equal(['completed','skipped'].includes(second.status), true);
  loop.stop();

  console.log('DESKTOP AUTONOMY LOOP: PASS');
})().catch(error => { console.error(error); process.exit(1); });
