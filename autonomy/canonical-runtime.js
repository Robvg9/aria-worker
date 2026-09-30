'use strict';

const { createAutonomousRuntime } = require('./autonomous-runtime');
const { createCognitiveMemory } = require('../memory/cognitive-memory');
const { createCognitiveLoop } = require('./cognitive-loop');
const { buildMissionContext, evaluateBehavior } = require('../chatbending/operational-engine');

function safeJson(value) {
  try { return JSON.stringify(value); } catch (_) { return String(value); }
}

function createCanonicalAriaRuntime(options = {}) {
  const { supabaseUrl, serviceRoleKey, memory = true, replanner = null, ...runtimeOptions } = options;
  const runtime = createAutonomousRuntime({ ...runtimeOptions, replanner, supabaseUrl, serviceRoleKey });
  const cognitiveMemory = memory ? createCognitiveMemory({ supabaseUrl, serviceRoleKey, fetchImpl: runtimeOptions.device?.fetchImpl || globalThis.fetch }) : null;

  const cognitiveLoop = cognitiveMemory
    ? createCognitiveLoop({ startMission: runtime.startMission, memory: cognitiveMemory })
    : null;

  async function runMission(input) {
    const result = await runtime.runMission(input);
    if (cognitiveMemory && result && typeof result === 'object') {
      const missionId = result.mission_id || result.missionId || input?.mission_id || input?.missionId || null;
      const status = result.status || 'unknown';
      const content = `Mission ${missionId || 'unknown'} completed with status=${status}. Result=${safeJson(result)}`;
      try {
        await cognitiveMemory.remember({
          memoryType: 'episodic',
          title: `Mission ${missionId || 'unknown'} outcome`,
          content,
          sourceType: 'mission',
          sourceRef: missionId,
          provenance: { runtime: 'canonical-runtime-v1', event: 'mission_completion' },
          metadata: { mission_id: missionId, status },
          confidence: status === 'succeeded' ? 1 : 0.8,
          importance: 0.7,
          salience: 0.8
        });
      } catch (_) {
        // Memory failure must never turn a completed mission into a failed mission.
      }
    }
    return result;
  }

  async function startMission(input = {}) {
    const metadata = input && typeof input.metadata === 'object' ? input.metadata : {};
    const cb = buildMissionContext({
      goal: input?.goal,
      project: input?.project || metadata.project || null,
      current_state: metadata.current_state || null,
      active_rules: metadata.active_rules || [],
      evidence: metadata.evidence || [],
      decisions: metadata.decisions || [],
      learnings: metadata.learnings || [],
      source_of_truth: metadata.source_of_truth || null,
      tools: metadata.tools || [],
      human_gates: metadata.human_gates || [],
      forbidden_actions: metadata.forbidden_actions || [],
      success_criteria: metadata.success_criteria || [],
      next_test: metadata.next_test || null
    });
    const governance = evaluateBehavior({
      context: cb,
      contradiction: metadata.chatbending_contradiction === true,
      stale: metadata.chatbending_stale === true
    });
    const enrichedInput = {
      ...input,
      metadata: { ...metadata, chatbending_context: cb, chatbending_behavior: governance },
      checkpoint: { ...(input?.checkpoint || {}), chatbending_context: cb, chatbending_behavior: governance }
    };
    if (metadata.chatbending_enforce === true && ['STOP', 'BLOCKED', 'REVALIDATE'].includes(governance.mode)) {
      return { mission_id: input?.mission_id || input?.missionId || null, status: governance.mode.toLowerCase(), reason: governance.reason, chatbending: governance };
    }
    if (!cognitiveLoop) return runtime.startMission(enrichedInput);
    return cognitiveLoop.run(enrichedInput);
  }

  return Object.freeze({
    version: 'canonical-runtime-v1',
    missionRepository: runtime.missionRepository,
    missionStore: runtime.missionStore,
    deviceClient: runtime.deviceClient,
    deviceDispatcher: runtime.deviceDispatcher,
    executor: runtime.executor,
    orchestrator: runtime.orchestrator,
    runMission,
    startMission,
    missionHttp: runtime.missionHttp,
    cognitiveMemory,
    cognitiveLoop,
    chatbending: Object.freeze({ buildMissionContext, evaluateBehavior })
  });
}

module.exports = Object.freeze({ createCanonicalAriaRuntime });
