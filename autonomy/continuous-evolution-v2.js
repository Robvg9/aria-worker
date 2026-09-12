'use strict';

const crypto = require('node:crypto');

const STAGES = Object.freeze([
  'observe',
  'diagnose',
  'research',
  'plan',
  'build',
  'test',
  'security',
  'evaluate',
  'promote',
  'deploy',
  'verify',
  'learn'
]);

const ACTION_STAGES = new Set(['build', 'promote', 'deploy']);
const TERMINAL = new Set(['completed', 'blocked', 'failed']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function normalizeStatus(value) {
  const status = value && typeof value.status === 'string' ? value.status : 'failed';
  if (!['ready', 'succeeded', 'completed', 'blocked', 'failed', 'skipped'].includes(status)) return 'failed';
  return status;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function normalizeResult(stage, value) {
  const result = value && typeof value === 'object' && !Array.isArray(value) ? value : { value };
  return Object.freeze({ stage, ...result });
}

function createContinuousEvolutionV2({
  observe,
  diagnose,
  research,
  plan,
  build,
  test,
  security,
  evaluate,
  promote,
  deploy,
  verify,
  learn,
  requireApproval = true,
  maxCycles = 1
} = {}) {
  const fns = { observe, diagnose, research, plan, build, test, security, evaluate, promote, deploy, verify, learn };
  for (const stage of STAGES) requireFn(fns[stage], stage);
  if (typeof requireApproval !== 'boolean') throw new TypeError('requireApproval must be boolean');
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 5) throw new TypeError('maxCycles must be an integer between 1 and 5');

  async function run(input = {}) {
    const cycles = [];
    let context = { input, policy: { requireApproval } };

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const results = {};
      const trace = [];

      for (const stage of STAGES) {
        if (requireApproval && ACTION_STAGES.has(stage) && input.approvals?.[stage] !== true) {
          const blocked = Object.freeze({ stage, status: 'blocked', reason: 'human_approval_required' });
          results[stage] = blocked;
          trace.push({ cycle, stage, status: blocked.status, fingerprint: fingerprint(blocked) });
          break;
        }

        const result = normalizeResult(stage, await fns[stage]({
          ...context,
          cycle,
          stage,
          trace: trace.slice(),
          results: { ...results }
        }));
        results[stage] = result;
        trace.push({ cycle, stage, status: normalizeStatus(result), fingerprint: fingerprint(result) });
        context = { ...context, [stage]: result };

        const status = normalizeStatus(result);
        if (status === 'blocked' || status === 'failed') break;
      }

      const record = Object.freeze({
        cycle,
        results: Object.freeze(results),
        trace: Object.freeze(trace)
      });
      cycles.push(record);
      context = { ...context, previous_cycle: record };

      const verifyStatus = normalizeStatus(results.verify);
      if (verifyStatus === 'completed' || verifyStatus === 'succeeded') {
        return Object.freeze({
          status: 'completed',
          version: 'continuous-evolution-v2',
          cycle,
          stages: STAGES,
          cycles: Object.freeze(cycles),
          evidence_hash: fingerprint({ cycle, trace }),
          stop_reason: 'verified'
        });
      }

      const last = Object.values(results).at(-1);
      if (last && TERMINAL.has(normalizeStatus(last))) {
        return Object.freeze({
          status: normalizeStatus(last),
          version: 'continuous-evolution-v2',
          cycle,
          stages: STAGES,
          cycles: Object.freeze(cycles),
          evidence_hash: fingerprint({ cycle, trace }),
          stop_reason: `stage_${last.stage}`
        });
      }
    }

    return Object.freeze({
      status: 'blocked',
      version: 'continuous-evolution-v2',
      cycle: maxCycles,
      stages: STAGES,
      cycles: Object.freeze(cycles),
      evidence_hash: fingerprint(cycles),
      stop_reason: 'max_cycles'
    });
  }

  return Object.freeze({ version: 'continuous-evolution-v2', stages: STAGES, run });
}

module.exports = Object.freeze({ STAGES, ACTION_STAGES, TERMINAL, fingerprint, createContinuousEvolutionV2 });
