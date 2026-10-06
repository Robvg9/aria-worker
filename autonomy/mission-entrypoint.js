'use strict';

const crypto = require('crypto');

function createMissionEntrypoint({ missionStore, runMission, idFactory = () => `mission_${crypto.randomUUID()}` } = {}) {
  if (!missionStore || typeof missionStore.create !== 'function') throw new TypeError('missionStore.create function required');
  if (typeof runMission !== 'function') throw new TypeError('runMission function required');
  if (typeof idFactory !== 'function') throw new TypeError('idFactory function required');

  async function createQueuedMission({ goal, mission_id = null, metadata = {}, checkpoint = {} } = {}) {
    if (typeof goal !== 'string' || goal.trim() === '') throw new TypeError('goal must be a non-empty string');
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new TypeError('metadata must be a JSON object');
    if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) throw new TypeError('checkpoint must be a JSON object');

    const id = typeof mission_id === 'string' && mission_id.trim() ? mission_id.trim() : idFactory();
    const mission = await missionStore.create({
      mission_id: id,
      goal: goal.trim(),
      status: 'queued',
      current_step: 0,
      total_steps: null,
      completed_steps: 0,
      attempt_count: 0,
      checkpoint,
      metadata
    });
    return Object.freeze({ mission });
  }

  async function startMission(input = {}) {
    const { mission } = await createQueuedMission(input);
    const result = await runMission(mission.mission_id);
    return Object.freeze({ mission, result });
  }

  async function queueMission(input = {}) {
    const { mission } = await createQueuedMission(input);
    return Object.freeze({ mission, result: { status: 'queued', execution_started: false } });
  }

  return Object.freeze({ startMission, queueMission });
}

module.exports = Object.freeze({ createMissionEntrypoint });