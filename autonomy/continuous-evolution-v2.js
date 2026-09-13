'use strict';

const crypto = require('node:crypto');

const STAGES = Object.freeze(['observe','diagnose','research','plan','build','test','security','evaluate','promote','deploy','verify','learn']);
const GATED_STAGES = new Set(['promote','deploy']);
const ACCEPTED_STATUSES = new Set(['ready','planned','succeeded','completed','blocked','failed','skipped']);

function requireFn(value, name) {
  if (typeof value !== 'function') throw new TypeError(`${name} function required`);
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function statusOf(value) {
  const status = value && typeof value.status === 'string' ? value.status : 'failed';
  return ACCEPTED_STATUSES.has(status) ? status : 'failed';
}

function createContinuousEvolutionV2({
  observe,
  diagnose,
  research = async () => ({ status: 'succeeded', mode: 'local-context' }),
  plan,
  build,
  test,
  security,
  evaluate,
  promote = async () => ({ status: 'skipped', reason: 'promotion_not_requested' }),
  deploy = async () => ({ status: 'skipped', reason: 'deployment_not_requested' }),
  verify,
  learn,
  maxCycles = 1
} = {}) {
  const fns = { observe, diagnose, research, plan, build, test, security, evaluate, promote, deploy, verify, learn };
  for (const stage of ['observe','diagnose','plan','build','test','security','evaluate','verify','learn']) requireFn(fns[stage], stage);
  if (!Number.isInteger(maxCycles) || maxCycles < 1 || maxCycles > 3) throw new TypeError('maxCycles must be an integer between 1 and 3');

  async function run(input = {}) {
    const cycles = [];
    let context = { input };

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const results = {};
      const trace = [];
      for (const stage of STAGES) {
        if (GATED_STAGES.has(stage) && input.approvals?.[stage] !== true) {
          results[stage] = Object.freeze({ stage, status: 'skipped', reason: 'human_gate_not_requested' });
          trace.push({ cycle, stage, status: 'skipped' });
          continue;
        }
        const raw = await fns[stage]({ ...context, cycle, stage, results: { ...results }, trace: trace.slice() });
        const result = Object.freeze({ stage, ...(raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { value: raw }) });
        results[stage] = result;
        const status = statusOf(result);
        trace.push({ cycle, stage, status, fingerprint: fingerprint(result) });
        context = { ...context, [stage]: result };
        if (status === 'blocked' || status === 'failed') break;
      }

      const record = Object.freeze({ cycle, results: Object.freeze(results), trace: Object.freeze(trace) });
      cycles.push(record);
      const verification = statusOf(results.verify);
      if (verification === 'completed' || verification === 'succeeded') {
        return Object.freeze({ status: 'completed', version: 'continuous-evolution-v2', cycle, stages: STAGES, cycles: Object.freeze(cycles), evidence_hash: fingerprint({ cycle, trace }), stop_reason: 'verified' });
      }
      const terminal = Object.values(results).find(item => ['blocked','failed'].includes(statusOf(item)));
      if (terminal) {
        return Object.freeze({ status: statusOf(terminal), version: 'continuous-evolution-v2', cycle, stages: STAGES, cycles: Object.freeze(cycles), evidence_hash: fingerprint({ cycle, trace }), stop_reason: `stage_${terminal.stage}` });
      }
    }

    return Object.freeze({ status: 'blocked', version: 'continuous-evolution-v2', cycle: maxCycles, stages: STAGES, cycles: Object.freeze(cycles), evidence_hash: fingerprint(cycles), stop_reason: 'max_cycles' });
  }

  return Object.freeze({ version: 'continuous-evolution-v2', stages: STAGES, run });
}

module.exports = Object.freeze({ STAGES, GATED_STAGES, ACCEPTED_STATUSES, fingerprint, createContinuousEvolutionV2 });
