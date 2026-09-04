'use strict';

const assert = require('assert');
const { createMissionEntrypoint } = require('../autonomy/mission-entrypoint');

(async () => {
  const created = [];
  const missionStore = {
    async create(input) {
      created.push(input);
      return input;
    }
  };
  const ran = [];
  const runMission = async (id) => {
    ran.push(id);
    return { status: 'succeeded' };
  };

  const entrypoint = createMissionEntrypoint({
    missionStore,
    runMission,
    idFactory: () => 'mission_test_1'
  });

  assert.throws(() => createMissionEntrypoint(), /missionStore.create function required/);
  assert.throws(() => createMissionEntrypoint({ missionStore }), /runMission function required/);
  assert.throws(() => entrypoint.startMission({ goal: '' }), /goal must be a non-empty string/);

  const result = await entrypoint.startMission({
    goal: 'build test application',
    metadata: { source: 'test' }
  });

  assert.strictEqual(created.length, 1);
  assert.strictEqual(created[0].mission_id, 'mission_test_1');
  assert.strictEqual(created[0].status, 'queued');
  assert.strictEqual(created[0].goal, 'build test application');
  assert.strictEqual(ran[0], 'mission_test_1');
  assert.strictEqual(result.result.status, 'succeeded');

  console.log('One-shot mission entrypoint: PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
