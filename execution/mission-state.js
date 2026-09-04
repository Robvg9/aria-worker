'use strict';

const STATUSES = Object.freeze([
  'queued', 'planning', 'running', 'waiting', 'blocked', 'paused',
  'failed', 'succeeded', 'cancelled'
]);

const STEP_STATUSES = Object.freeze([
  'pending', 'running', 'waiting', 'blocked', 'failed', 'succeeded', 'skipped'
]);

const TERMINAL_STATUSES = new Set(['succeeded', 'failed', 'cancelled']);

const TRANSITIONS = Object.freeze({
  queued: new Set(['planning', 'running', 'cancelled']),
  planning: new Set(['running', 'waiting', 'blocked', 'failed', 'cancelled']),
  running: new Set(['waiting', 'blocked', 'failed', 'succeeded', 'paused', 'cancelled']),
  waiting: new Set(['running', 'blocked', 'cancelled']),
  blocked: new Set(['planning', 'running', 'cancelled']),
  paused: new Set(['planning', 'running', 'cancelled']),
  failed: new Set(['planning', 'running', 'cancelled']),
  succeeded: new Set(),
  cancelled: new Set()
});

function assertString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

function assertStatus(status) {
  if (!STATUSES.includes(status)) throw new TypeError(`invalid mission status: ${status}`);
}

function normalizeMission(input) {
  if (!input || typeof input !== 'object') throw new TypeError('mission must be an object');
  assertString(input.mission_id, 'mission_id');
  assertString(input.goal, 'goal');

  const status = input.status ?? 'queued';
  assertStatus(status);

  const currentStep = input.current_step ?? 0;
  const completedSteps = input.completed_steps ?? 0;
  const totalSteps = input.total_steps ?? null;

  if (!Number.isInteger(currentStep) || currentStep < 0) throw new TypeError('current_step must be a non-negative integer');
  if (!Number.isInteger(completedSteps) || completedSteps < 0) throw new TypeError('completed_steps must be a non-negative integer');
  if (totalSteps !== null && (!Number.isInteger(totalSteps) || totalSteps < 0)) throw new TypeError('total_steps must be null or a non-negative integer');
  if (totalSteps !== null && completedSteps > totalSteps) throw new TypeError('completed_steps cannot exceed total_steps');

  return {
    mission_id: input.mission_id,
    goal: input.goal,
    status,
    current_step: currentStep,
    total_steps: totalSteps,
    completed_steps: completedSteps,
    attempt_count: input.attempt_count ?? 0,
    current_agent_id: input.current_agent_id ?? null,
    current_workspace: input.current_workspace ?? null,
    last_command: input.last_command ?? null,
    last_exit_code: input.last_exit_code ?? null,
    last_stdout: input.last_stdout ?? null,
    last_stderr: input.last_stderr ?? null,
    next_action: input.next_action ?? null,
    checkpoint: input.checkpoint && typeof input.checkpoint === 'object' ? input.checkpoint : {},
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    created_at: input.created_at ?? null,
    updated_at: input.updated_at ?? null,
    finished_at: input.finished_at ?? null
  };
}

function assertTransition(from, to) {
  assertStatus(from);
  assertStatus(to);
  if (!TRANSITIONS[from].has(to)) {
    throw new Error(`invalid mission transition: ${from} -> ${to}`);
  }
}

function transitionMission(mission, nextStatus, patch = {}) {
  const current = normalizeMission(mission);
  assertTransition(current.status, nextStatus);

  const next = normalizeMission({ ...current, ...patch, status: nextStatus });
  if (TERMINAL_STATUSES.has(nextStatus)) {
    if (!next.finished_at) next.finished_at = new Date().toISOString();
  } else {
    next.finished_at = null;
  }
  return next;
}

function checkpointMission(mission, checkpoint, patch = {}) {
  const current = normalizeMission(mission);
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    throw new TypeError('checkpoint must be a JSON object');
  }
  return normalizeMission({
    ...current,
    ...patch,
    checkpoint: { ...checkpoint },
    status: patch.status ?? current.status
  });
}

function createMissionStateStore(repository) {
  if (!repository || typeof repository !== 'object') throw new TypeError('repository is required');
  for (const method of ['createMission', 'getMission', 'updateMission', 'appendEvent']) {
    if (typeof repository[method] !== 'function') throw new TypeError(`repository.${method} is required`);
  }

  return Object.freeze({
    async create(input) {
      const mission = normalizeMission(input);
      const saved = await repository.createMission(mission);
      await repository.appendEvent(mission.mission_id, {
        event_type: 'mission_created',
        payload: { status: mission.status, goal: mission.goal }
      });
      return normalizeMission(saved);
    },

    async get(missionId) {
      assertString(missionId, 'missionId');
      const result = await repository.getMission(missionId);
      return result ? normalizeMission(result) : null;
    },

    async transition(missionId, nextStatus, patch = {}) {
      const current = await this.get(missionId);
      if (!current) throw new Error(`mission not found: ${missionId}`);
      const next = transitionMission(current, nextStatus, patch);
      const saved = await repository.updateMission(missionId, next);
      await repository.appendEvent(missionId, {
        event_type: nextStatus === 'succeeded' ? 'mission_succeeded' :
          nextStatus === 'failed' ? 'mission_failed' :
          nextStatus === 'cancelled' ? 'mission_cancelled' :
          nextStatus === 'blocked' ? 'mission_blocked' :
          nextStatus === 'waiting' ? 'mission_waiting' :
          nextStatus === 'running' && current.status === 'paused' ? 'mission_resumed' :
          'mission_started',
        payload: { from_status: current.status, to_status: nextStatus }
      });
      return normalizeMission(saved);
    },

    async checkpoint(missionId, checkpoint, patch = {}) {
      const current = await this.get(missionId);
      if (!current) throw new Error(`mission not found: ${missionId}`);
      const next = checkpointMission(current, checkpoint, patch);
      const saved = await repository.updateMission(missionId, next);
      await repository.appendEvent(missionId, {
        event_type: 'checkpoint_saved',
        payload: { current_step: next.current_step, completed_steps: next.completed_steps }
      });
      return normalizeMission(saved);
    }
  });
}

module.exports = {
  STATUSES,
  STEP_STATUSES,
  TERMINAL_STATUSES,
  normalizeMission,
  assertTransition,
  transitionMission,
  checkpointMission,
  createMissionStateStore
};
