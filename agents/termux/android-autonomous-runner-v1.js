'use strict';

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TIMEOUT_MS = 160_000;
const DECISION_TIMEOUT_MS = 20_000;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, Math.max(0, ms))); }
function sanitizeReason(value) { return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 700); }
function summarizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  return { action: typeof action.action === 'string' ? action.action : null, nodeId: typeof action.nodeId === 'string' ? action.nodeId : null, keyCode: Number.isInteger(action.keyCode) ? action.keyCode : null, direction: typeof action.direction === 'string' ? action.direction : null, url: typeof action.url === 'string' ? action.url : null, ms: Number.isFinite(Number(action.ms)) ? action.ms : null };
}
function resultFromBridge(bridgeResult) { return bridgeResult && (bridgeResult.payload || bridgeResult.result) || null; }
function observationFromBridge(bridgeResult) { const payload = resultFromBridge(bridgeResult); return payload && payload.ok === true ? payload : null; }

async function decide({ api, goal, observation, history, targetPackage, allowedHosts }) {
  const payload = await api('/v1/android/autonomous/decide', {
    method: 'POST',
    body: JSON.stringify({ goal, target_package: targetPackage || null, allowed_hosts: Array.isArray(allowedHosts) ? allowedHosts : [], observation, history: Array.isArray(history) ? history.slice(-8) : [] }),
    timeoutMs: DECISION_TIMEOUT_MS
  });
  if (!payload || payload.ok !== true || !payload.decision) throw new Error(payload && payload.error || 'android_autonomous_decision_invalid');
  return payload;
}

async function executeAutonomousAndroidMission({ api, executeAndroidAccessibilityJob, goal, targetPackage, allowAnyApp, allowedHosts, startUrl, startApp = false, maxSteps = DEFAULT_MAX_STEPS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof api !== 'function') throw new TypeError('api_required');
  if (typeof executeAndroidAccessibilityJob !== 'function') throw new TypeError('android_executor_required');
  if (!goal || typeof goal !== 'string') throw new TypeError('goal_required');
  const started = Date.now();
  const boundedSteps = Math.max(1, Math.min(16, Number(maxSteps) || DEFAULT_MAX_STEPS));
  const history = [];
  const evidence = [];
  let observation = null;
  const remaining = () => Math.max(2_000, timeoutMs - (Date.now() - started));
  const observe = async phase => {
    const bridge = await executeAndroidAccessibilityJob({ command: JSON.stringify({ operation: 'observe', target_package: targetPackage || null, allow_any_app: allowAnyApp === true, allowed_hosts: allowedHosts }), timeoutMs: Math.min(12_000, remaining()) });
    const payload = observationFromBridge(bridge);
    if (!payload) throw new Error('android_observe_failed:' + sanitizeReason(bridge && (bridge.reason || bridge.stderr)));
    evidence.push({ phase, evidence_hash: payload.evidence_hash || null, package_name: payload.packageName || null });
    return payload;
  };
  if (startApp && targetPackage) {
    const pre = await executeAndroidAccessibilityJob({
      command: JSON.stringify({
        operation: 'action',
        target_package: targetPackage,
        allow_any_app: allowAnyApp === true,
        allowed_hosts: allowedHosts,
        action: { action: 'launch_app' }
      }),
      timeoutMs: Math.min(12_000, remaining())
    });
    if (!pre || pre.status !== 'succeeded' || !pre.payload || pre.payload.ok !== true) {
      return { status: 'failed', reason: 'android_app_launch_failed', steps: 0, trace: [], evidence };
    }
    const launched = pre.payload.ui;
    if (launched && launched.ok === true) {
      observation = launched;
      evidence.push({ phase: 'observe_after_launch', evidence_hash: pre.payload.evidence_hash || launched.evidence_hash || null, package_name: launched.packageName || null });
    }
  }
  if (startUrl) {
    const pre = await executeAndroidAccessibilityJob({
      command: JSON.stringify({
        operation: 'action',
        target_package: targetPackage || null,
        allow_any_app: allowAnyApp === true,
        allowed_hosts: allowedHosts,
        action: { action: 'navigate', url: startUrl }
      }),
      timeoutMs: Math.min(12_000, remaining())
    });
    if (!pre || pre.status !== 'succeeded' || !pre.payload || pre.payload.ok !== true) {
      return { status: 'failed', reason: 'android_start_url_navigation_failed', steps: 0, trace: [], evidence };
    }
    const navigated = pre.payload.ui;
    if (navigated && navigated.ok === true) {
      observation = navigated;
      evidence.push({ phase: 'observe_after_navigation', evidence_hash: pre.payload.evidence_hash || navigated.evidence_hash || null, package_name: navigated.packageName || null });
    }
  }
  observation = observation || await observe('observe_before');
  for (let step = 0; step < boundedSteps; step += 1) {
    if (remaining() <= 2_000) return { status: 'timeout', reason: 'autonomous_test_timeout', steps: step, trace: history, evidence };
    const decision = await decide({ api, goal, observation, history, targetPackage, allowedHosts });
    const decisionRecord = { step: step + 1, decision: decision.decision, reason: sanitizeReason(decision.reason), action: summarizeAction(decision.action), expectation: decision.expectation || null, before_evidence_hash: observation.evidence_hash || null };
    history.push(decisionRecord);
    if (decision.decision === 'pass') {
      const hasVerifiedAction = history.some(entry => entry.execution?.status === 'succeeded' && entry.execution.after_evidence_hash);
      if (!hasVerifiedAction) {
        return {
          status: 'failed',
          reason: 'android_autonomous_pass_without_verified_action',
          steps: step + 1,
          trace: history,
          evidence
        };
      }
      return { status: 'succeeded', reason: sanitizeReason(decision.reason || 'autonomous_test_passed'), steps: step, trace: history, evidence };
    }
    if (decision.decision === 'fail' || decision.decision === 'blocked') return { status: 'failed', reason: sanitizeReason(decision.reason || 'autonomous_test_failed'), steps: step, trace: history, evidence };
    if (decision.decision !== 'act' || !decision.action || typeof decision.action !== 'object') return { status: 'failed', reason: 'android_autonomous_decision_not_actionable', steps: step + 1, trace: history, evidence };
    const bridge = await executeAndroidAccessibilityJob({ command: JSON.stringify({ operation: 'action', target_package: targetPackage || null, allow_any_app: allowAnyApp === true, allowed_hosts: allowedHosts, action: decision.action }), timeoutMs: Math.min(12_000, remaining()) });
    if (!bridge || bridge.status !== 'succeeded' || !bridge.payload || bridge.payload.ok !== true) {
      history[history.length - 1].execution = { status: 'failed', reason: sanitizeReason(bridge && (bridge.reason || bridge.stderr || 'android_action_failed')) };
      return { status: 'failed', reason: sanitizeReason(bridge && (bridge.reason || bridge.stderr || 'android_action_failed')), steps: step + 1, trace: history, evidence };
    }
    const after = bridge.payload.ui;
    const afterHash = bridge.payload.evidence_hash || (after && after.evidence_hash) || null;
    history[history.length - 1].execution = { status: 'succeeded', after_evidence_hash: afterHash };
    evidence.push({ phase: 'observe_after', step: step + 1, evidence_hash: afterHash, package_name: after && after.packageName || null });
    if (!after || after.ok !== true) return { status: 'failed', reason: 'android_post_action_observation_missing', steps: step + 1, trace: history, evidence };
    observation = after;
    await delay(100);
  }
  return { status: 'failed', reason: 'autonomous_test_step_limit_reached', steps: boundedSteps, trace: history, evidence };
}

module.exports = Object.freeze({ DEFAULT_MAX_STEPS, executeAutonomousAndroidMission, summarizeAction });
