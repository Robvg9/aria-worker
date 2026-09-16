'use strict';

const { detectPattern, buildCountermeasure, evaluateRecurrence, failureSignature } = require('./failure-pattern-engine-v1');

function createFailureIntelligenceRuntime({
  historyProvider = async () => [],
  persistPattern = null,
  onRootCauseRequired = null,
  patternDetector = detectPattern
} = {}) {
  if (typeof historyProvider !== 'function') throw new TypeError('historyProvider must be a function');
  if (typeof patternDetector !== 'function') throw new TypeError('patternDetector must be a function');

  async function observeFailure(episode) {
    if (!episode || typeof episode !== 'object') throw new TypeError('episode_required');
    const history = await historyProvider({ episode });
    if (!Array.isArray(history)) throw new TypeError('history_provider_must_return_array');
    const combined = [...history, episode];
    const patterns = patternDetector(combined);
    const signature = failureSignature(episode);
    const pattern = patterns.find(item => item.signature === signature) || null;
    if (!pattern) return Object.freeze({ status: 'incident', pattern: null, countermeasure: null });

    const recurrence = evaluateRecurrence(pattern, episode);
    const countermeasure = buildCountermeasure(pattern, {
      preventionProcedure: episode.prevention_procedure || [],
      evidenceRefs: episode.evidence_refs || []
    });
    const result = Object.freeze({ status: pattern.state, pattern, recurrence, countermeasure });

    if (typeof persistPattern === 'function') await persistPattern(result, episode);
    if (pattern.state === 'root_cause_required' && typeof onRootCauseRequired === 'function') {
      await onRootCauseRequired(result, episode);
    }
    return result;
  }

  return Object.freeze({ version: 'failure-intelligence-runtime-v1', observeFailure });
}

module.exports = Object.freeze({ createFailureIntelligenceRuntime });
