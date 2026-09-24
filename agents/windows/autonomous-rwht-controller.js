'use strict';

const crypto = require('node:crypto');
let executeWindowsDesktop;
try {
  ({ executeWindowsDesktop } = require('./windows-desktop-adapter'));
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  ({ executeWindowsDesktop } = require('../../computer-use/windows-desktop-adapter'));
}

const VERSION = 'aria-windows-autonomous-rwht-v1.1.0';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'qwen3:4b';

const INTERACTIVE_ROLES = new Set([
  'button', 'hyperlink', 'tab', 'menuitem', 'checkbox', 'radiobutton',
  'combobox', 'edit', 'listitem', 'treeitem', 'splitbutton'
]);

const BLOCKED = /(delete|remove|destroy|reset|revoke|logout|log\s*out|sign\s*out|clear\s+all|wipe|trash|borrar|eliminar|destruir|restablecer|revocar|cerrar\s+sesión|cerrar\s+sesion|salir|vaciar)/i;
const SECRET = /(password|passwd|token|secret|api[_ -]?key|private\s+key|bearer|credential|contraseña|contrasena)/i;

function nodeLabel(node) {
  return String((node && (node.name || node.label || node.text)) || '').trim();
}

function isInteractive(node) {
  return Boolean(
    node &&
    node.visible !== false &&
    node.enabled !== false &&
    INTERACTIVE_ROLES.has(String(node.role || '').toLowerCase())
  );
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function controlKey(screenHash, nodeId) {
  return hash([screenHash, String(nodeId)]);
}

function sanitize(raw) {
  const ui = raw && raw.ui && typeof raw.ui === 'object' ? raw.ui : raw;
  const nodes = Array.isArray(ui && ui.nodes) ? ui.nodes : [];
  return {
    surface: String((ui && ui.surface) || 'windows-desktop'),
    title: ui && ui.title == null ? null : String(ui.title),
    url: ui && ui.url == null ? null : String(ui.url),
    nodes: nodes.slice(0, 350).map((node) => ({
      id: String(node.id || ''),
      role: String(node.role || ''),
      name: node.name == null ? null : String(node.name),
      text: node.text == null ? null : String(node.text),
      label: node.label == null ? null : String(node.label),
      enabled: node.enabled !== false,
      visible: node.visible !== false,
      attributes: node.attributes && typeof node.attributes === 'object'
        ? {
            x: Number(node.attributes.x),
            y: Number(node.attributes.y),
            width: Number(node.attributes.width),
            height: Number(node.attributes.height),
          }
        : {},
    })),
    metadata: {
      source: ui && ui.metadata && ui.metadata.source || 'windows-uia',
      node_count: nodes.length,
    },
  };
}

function compact(ui) {
  return {
    title: ui.title,
    url: ui.url,
    nodes: ui.nodes.filter(isInteractive).slice(0, 120).map((node) => ({
      id: node.id,
      role: node.role,
      label: nodeLabel(node),
      enabled: node.enabled,
      x: node.attributes.x,
      y: node.attributes.y,
      w: node.attributes.width,
      h: node.attributes.height,
    })),
  };
}

function safeNodes(ui) {
  return ui.nodes.filter((node) => isInteractive(node) && !BLOCKED.test(nodeLabel(node)));
}

function find(ui, id) {
  return ui.nodes.find((node) => node.id === String(id)) || null;
}

function center(node) {
  const a = node && node.attributes || {};
  const x = Number(a.x);
  const y = Number(a.y);
  const w = Number(a.width);
  const h = Number(a.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.round(x + Math.max(1, Number.isFinite(w) ? w : 1) / 2),
    y: Math.round(y + Math.max(1, Number.isFinite(h) ? h : 1) / 2),
  };
}

function parseJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function qwen(prompt, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs || 120000));
  try {
    const response = await fetch(OLLAMA_URL + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, prompt, stream: false }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || typeof (body && body.response) !== 'string') {
      throw new Error('ollama_' + String(response.status || 'invalid'));
    }
    return body.response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().slice(0, 18000);
  } finally {
    clearTimeout(timer);
  }
}

function capabilityProfile(deviceId) {
  return {
    version: 'capability-awareness-v1',
    device_id: deviceId,
    capabilities: [
      {
        id: 'computer.use',
        operation: 'computer.use',
        purpose: 'control real Windows desktop UI',
        actions: ['observe', 'screenshot', 'click', 'double_click', 'type', 'keypress', 'hotkey', 'scroll', 'focus', 'wait'],
        verification: 'observe after action',
      },
      {
        id: 'ollama.qwen3',
        operation: 'ollama.qwen3',
        model: OLLAMA_MODEL,
        purpose: 'structured UI reasoning',
      },
      {
        id: 'computer.use.autonomous',
        operation: 'computer.use.autonomous',
        purpose: 'observe -> decide -> act -> verify -> adapt',
        requires: ['computer.use', 'ollama.qwen3'],
      },
    ],
    constraints: [
      'destructive controls blocked by default',
      'secret-like input blocked',
      'every action followed by observation',
      'mission is not successful until coverage-complete',
    ],
  };
}

function promptFor(goal, ui, capabilities, history, screenHash, exercised) {
  const available = safeNodes(ui)
    .filter((node) => !exercised.has(controlKey(screenHash, node.id)))
    .slice(0, 80);

  return [
    'ARIA WINDOWS RWHT CONTROLLER.',
    'OBJETIVO: ' + goal,
    'CAPACIDADES REALES: ' + JSON.stringify(capabilities),
    'REGLAS: usa solo nodos observados; prioriza cobertura real; no destructivos; no secretos; observa después de cada acción; NO finalices mientras existan controles seguros sin ejercitar.',
    'ACCIONES: click,double_click,type,scroll,back,wait,screenshot,finish.',
    'RESPUESTA: solo JSON válido. Ejemplo click: {"action":"click","node_id":"ID","reason":"..."}',
    'Ejemplo type: {"action":"type","node_id":"ID","text":"ARIA_RWHT_TEST","reason":"..."}',
    'CONTROLES SEGUROS PENDIENTES: ' + JSON.stringify(available.map((node) => ({
      id: node.id,
      role: node.role,
      label: nodeLabel(node),
    }))),
    'OBSERVACIÓN ACTUAL: ' + JSON.stringify(compact(ui)),
    'HISTORIAL: ' + JSON.stringify(history.slice(-8)),
  ].join('\n');
}

function normalizeDecision(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const action = String(raw.action || '').trim().toLowerCase();
  if (!['click', 'double_click', 'type', 'scroll', 'back', 'wait', 'screenshot', 'finish'].includes(action)) return null;
  return {
    action,
    node_id: raw.node_id == null ? null : String(raw.node_id),
    text: raw.text == null ? 'ARIA_RWHT_TEST' : String(raw.text),
    delta: Number.isFinite(Number(raw.delta)) ? Number(raw.delta) : 650,
    ms: Number.isFinite(Number(raw.ms)) ? Number(raw.ms) : 1000,
    reason: String(raw.reason || '').slice(0, 500),
  };
}

function validateDecision(decision, ui) {
  if (!decision) return { ok: false, reason: 'decision_invalid' };

  if (['click', 'double_click', 'type'].includes(decision.action)) {
    const node = find(ui, decision.node_id);
    if (!node) return { ok: false, reason: 'target_not_found' };
    if (!isInteractive(node)) return { ok: false, reason: 'target_not_interactive', node };
    if (BLOCKED.test(nodeLabel(node))) {
      return { ok: false, reason: 'high_risk_control_blocked', node };
    }
    if (decision.action === 'type' && (SECRET.test(nodeLabel(node)) || SECRET.test(decision.text))) {
      return { ok: false, reason: 'secret_input_blocked', node };
    }
  }

  if (decision.action === 'scroll' && Math.abs(decision.delta) > 2500) {
    return { ok: false, reason: 'scroll_delta_too_large' };
  }

  if (decision.action === 'wait' && (decision.ms < 0 || decision.ms > 10000)) {
    return { ok: false, reason: 'wait_invalid' };
  }

  return { ok: true };
}

async function executeDecision(adapter, decision, ui) {
  if (decision.action === 'finish') return { status: 'finished' };
  if (decision.action === 'back') return adapter({ action: 'hotkey', keys: ['ALT', 'LEFT'] });
  if (decision.action === 'scroll') return adapter({ action: 'scroll', delta: decision.delta });
  if (decision.action === 'wait') return adapter({ action: 'wait', ms: decision.ms });
  if (decision.action === 'screenshot') return adapter({ action: 'screenshot' });

  const node = find(ui, decision.node_id);
  const bounds = center(node);
  if (!bounds) return { status: 'failed', error: 'target_bounds_missing' };

  if (decision.action === 'type') {
    const focus = await adapter({ action: 'click', x: bounds.x, y: bounds.y });
    if (focus && focus.status !== 'succeeded') {
      return { status: 'failed', error: focus.error || 'type_target_focus_failed' };
    }
    const typed = await adapter({ action: 'type', text: decision.text });
    return {
      status: typed && typed.status || 'failed',
      error: typed && typed.error || null,
    };
  }

  return adapter({ action: decision.action, x: bounds.x, y: bounds.y });
}

async function navigate(adapter, url) {
  if (!url) return { status: 'skipped' };

  const steps = [
    { action: 'focus', process: 'chrome' },
    { action: 'hotkey', keys: ['CTRL', 'L'] },
    { action: 'type', text: url },
    { action: 'keypress', key: 'ENTER' },
    { action: 'wait', ms: 1500 },
  ];

  const results = [];
  for (const step of steps) {
    const result = await adapter(step);
    results.push({
      action: step.action,
      status: result && result.status || 'unknown',
      error: result && result.error || null,
    });
    if (!result || result.status !== 'succeeded') break;
  }

  return {
    status: results.every((item) => item.status === 'succeeded') ? 'succeeded' : 'failed',
    results,
  };
}

async function runAutonomousRwht(options) {
  const o = options || {};
  const missionId = o.mission_id || ('rwht-' + Date.now());
  const goal = o.goal || 'Ejecutar RWHT autónomo desde PC.';
  const deviceId = o.device_id || null;
  const startUrl = o.start_url || null;
  const maxActions = Math.max(5, Math.min(250, Number(o.max_actions) || 120));
  const maxRuntimeMs = Math.max(30000, Math.min(900000, Number(o.max_runtime_ms) || 600000));
  const adapter = o.adapter || executeWindowsDesktop;
  const model = o.model || qwen;
  const captureScreenshots = o.capture_screenshots !== false;
  const onProgress = typeof o.on_progress === 'function' ? o.on_progress : null;
  const started = Date.now();

  async function emitProgress(event_type, payload = {}, step_index = null) {
    if (!onProgress) return;
    try {
      await onProgress({ event_type, step_index, payload: { ...payload, mission_id: missionId } });
    } catch {
      // Live telemetry must never break the physical RWHT execution path.
    }
  }

  const capabilities = capabilityProfile(deviceId);
  const history = [];
  const evidence = [];
  const blocked = [];
  const screensSeen = new Set();
  const discoveredControls = new Set();
  const exercisedControls = new Set();
  const blockedControls = new Set();
  const lastDecisions = new Set();

  await emitProgress('computer_use_capabilities_confirmed', {
    capabilities: capabilities.capabilities.map((item) => ({
      id: item.id,
      operation: item.operation,
      requires: item.requires || null,
    })),
  });
  await emitProgress('computer_use_device_confirmed', {
    device_id: deviceId,
    surface: 'windows-desktop',
    start_url: startUrl,
  });

  const navigation = await navigate(adapter, startUrl).catch((error) => ({
    status: 'failed',
    error: String(error && error.message || error),
  }));

  const observe = async (reason = 'initial') => {
    await emitProgress('computer_use_observation_started', {
      reason,
    });
    const result = await adapter({ action: 'observe' }, { timeout_ms: 30000 });
    if (!result || result.status !== 'succeeded') {
      await emitProgress('computer_use_observation_completed', {
        reason,
        status: 'failed',
        error: result && result.error ? String(result.error).slice(0, 500) : 'observe_failed',
      });
      throw new Error(result && result.error || 'observe_failed');
    }
    const sanitized = sanitize(result.ui || result);
    await emitProgress('computer_use_observation_completed', {
      reason,
      status: 'succeeded',
      title: sanitized.title,
      surface: sanitized.surface,
      control_count: sanitized.nodes.length,
    });
    return sanitized;
  };

  let current = await observe('inicio');
  let finishReason = 'runtime_limit';
  let noProgressStreak = 0;

  if (navigation.status !== 'skipped') {
    evidence.push({
      kind: 'start_navigation',
      result: navigation,
      verified: navigation.status === 'succeeded',
    });
  }

  for (let step = 1; step <= maxActions && Date.now() - started < maxRuntimeMs; step += 1) {
    const screenHash = hash(compact(current));
    screensSeen.add(screenHash);

    const safe = safeNodes(current);
    safe.forEach((node) => discoveredControls.add(controlKey(screenHash, node.id)));

    const pending = safe.filter((node) => {
      const key = controlKey(screenHash, node.id);
      return !exercisedControls.has(key) && !blockedControls.has(key);
    });

    let decision = null;
    let decisionSource = 'qwen3';
    let modelError = null;

    try {
      decision = normalizeDecision(await model(
        promptFor(goal, current, capabilities, history, screenHash, exercisedControls),
        120000
      ));
    } catch (error) {
      decisionSource = 'fallback';
      modelError = String(error && error.message || error);
    }

    if (!decision) {
      decisionSource = 'fallback';
      if (pending.length) {
        decision = {
          action: 'click',
          node_id: pending[0].id,
          reason: 'fallback coverage of safe unexercised control',
        };
      } else if (noProgressStreak < 2) {
        decision = {
          action: 'scroll',
          delta: 650,
          reason: 'discover additional interface controls',
        };
      } else {
        decision = {
          action: 'back',
          reason: 'search another application section',
        };
      }
    }

    if (decision.action === 'finish') {
      if (pending.length === 0 && noProgressStreak >= 2 && screensSeen.size > 1) {
        finishReason = 'coverage_complete';
        break;
      }
      if (pending.length) {
        decision = {
          action: 'click',
          node_id: pending[0].id,
          reason: 'finish rejected because safe controls remain',
        };
        decisionSource = 'governance_override';
      } else {
        decision = {
          action: 'scroll',
          delta: 650,
          reason: 'finish rejected until another section is checked',
        };
        decisionSource = 'governance_override';
      }
    }

    await emitProgress('computer_use_decision_made', {
      step,
      action: decision.action,
      node_id: decision.node_id,
      reason: decision.reason,
      decision_source: decisionSource,
      model_error: modelError,
    }, step);

    const safety = validateDecision(decision, current);

    if (!safety.ok) {
      const blockedKey = decision.node_id
        ? controlKey(screenHash, decision.node_id)
        : hash([screenHash, decision.action, safety.reason]);

      if (decision.node_id) blockedControls.add(blockedKey);
      blocked.push({
        step,
        action: decision.action,
        node_id: decision.node_id,
        reason: safety.reason,
        label: nodeLabel(safety.node),
      });
      await emitProgress('computer_use_action_blocked', {
        step,
        action: decision.action,
        node_id: decision.node_id,
        reason: safety.reason,
      }, step);
      history.push({
        step,
        event: 'blocked',
        reason: safety.reason,
        node_id: decision.node_id,
        model_error: modelError,
      });
      noProgressStreak += 1;
      continue;
    }

    const beforeHash = screenHash;
    const target = decision.node_id ? find(current, decision.node_id) : null;

    await emitProgress('computer_use_action_started', {
      step,
      action: decision.action,
      node_id: decision.node_id,
      label: target ? nodeLabel(target) : null,
      reason: decision.reason,
    }, step);

    const result = await executeDecision(adapter, decision, current);
    await emitProgress('computer_use_action_executed', {
      step,
      action: decision.action,
      node_id: decision.node_id,
      status: result && result.status || 'unknown',
      error: result && result.error ? String(result.error).slice(0, 500) : null,
    }, step);

    const after = await observe('después de la acción').catch(() => null);
    const afterHash = after ? hash(compact(after)) : null;

    const executionVerified = Boolean(result && result.status === 'succeeded' && after);
    const effectObserved = Boolean(afterHash && afterHash !== beforeHash);

    await emitProgress('computer_use_result_observed', {
      step,
      action: decision.action,
      result_status: result && result.status || 'unknown',
      effect_observed: effectObserved,
      after_observation_available: Boolean(after),
    }, step);

    if (decision.node_id) {
      exercisedControls.add(controlKey(beforeHash, decision.node_id));
    }

    await emitProgress('computer_use_verification_completed', {
      step,
      action: decision.action,
      verified: executionVerified,
      effect_observed: effectObserved,
      coverage_progress: {
        discovered: discoveredControls.size,
        exercised: exercisedControls.size,
        blocked: blockedControls.size,
      },
    }, step);

    const decisionKey = JSON.stringify([beforeHash, decision.action, decision.node_id || null]);
    if (lastDecisions.has(decisionKey)) {
      noProgressStreak += 1;
    } else {
      lastDecisions.add(decisionKey);
      noProgressStreak = executionVerified && effectObserved ? 0 : noProgressStreak + 1;
    }

    const item = {
      step,
      action: decision.action,
      node_id: decision.node_id,
      label: nodeLabel(target),
      reason: decision.reason,
      decision_source: decisionSource,
      result_status: result && result.status || 'unknown',
      verified: executionVerified,
      effect_observed: effectObserved,
      before_screen: beforeHash,
      after_screen: afterHash,
      error: result && result.error || null,
      model_error: modelError,
      timestamp: new Date().toISOString(),
    };

    evidence.push(item);
    history.push(item);
    current = after || current;

    if (captureScreenshots && (step === 1 || step % 10 === 0)) {
      try {
        const shot = await adapter({ action: 'screenshot' }, { timeout_ms: 30000 });
        evidence.push({
          step,
          kind: 'screenshot',
          screenshot_hash: shot && shot.screenshot_base64
            ? crypto.createHash('sha256').update(shot.screenshot_base64).digest('hex')
            : null,
          verified: shot && shot.status === 'succeeded',
        });
      } catch (error) {
        evidence.push({
          step,
          kind: 'screenshot',
          verified: false,
          error: String(error && error.message || error),
        });
      }
    }

    if (executionVerified && safeNodes(current).every((node) =>
      exercisedControls.has(controlKey(afterHash || beforeHash, node.id)) ||
      blockedControls.has(controlKey(afterHash || beforeHash, node.id))
    ) && noProgressStreak >= 2 && screensSeen.size > 1) {
      finishReason = 'coverage_complete';
      break;
    }
  }

  if (finishReason === 'runtime_limit' && exercisedControls.size > 0) {
    finishReason = 'bounded_run_exhausted';
  }

  const verifiedActions = evidence.filter((item) => item.step && item.verified === true);
  const coverageRatio = discoveredControls.size
    ? Number((exercisedControls.size / discoveredControls.size).toFixed(3))
    : 0;
  const complete = finishReason === 'coverage_complete';
  const status = complete ? 'succeeded' : (verifiedActions.length ? 'partial' : 'failed');

  const summary = {
    version: VERSION,
    status,
    mission_id: missionId,
    goal,
    device_id: deviceId,
    start_url: startUrl,
    finished_reason: finishReason,
    duration_ms: Date.now() - started,
    actions_attempted: evidence.filter((item) => item.step && item.action).length,
    actions_verified: verifiedActions.length,
    screens_seen: screensSeen.size,
    controls_discovered: discoveredControls.size,
    controls_exercised: exercisedControls.size,
    blocked_controls: blocked.length,
    coverage_ratio: coverageRatio,
    evidence_count: evidence.length,
  };

  return {
    ...summary,
    verified: complete,
    verification_status: complete ? 'verified' : status,
    capability_awareness: capabilities,
    coverage: {
      screens_seen: screensSeen.size,
      controls_discovered: discoveredControls.size,
      controls_exercised: exercisedControls.size,
      blocked: blocked.slice(0, 100),
      ratio: coverageRatio,
    },
    evidence: evidence.slice(-250),
    response: {
      content: JSON.stringify(summary),
      human_summary: complete
        ? 'RWHT PC finalizado con ' + summary.actions_verified + ' acciones verificadas, ' + summary.screens_seen + ' pantallas y ' + Math.round(summary.coverage_ratio * 100) + '% de cobertura registrada.'
        : 'RWHT PC ejecutado parcialmente: ' + summary.actions_verified + ' acciones verificadas, ' + summary.screens_seen + ' pantallas y ' + Math.round(summary.coverage_ratio * 100) + '% de cobertura registrada.',
    },
    stdout: JSON.stringify(summary),
  };
}

module.exports = Object.freeze({
  VERSION,
  capabilityProfile,
  parseJson,
  isHighRiskLabel: function (value) {
    return BLOCKED.test(String(value || ''));
  },
  runAutonomousRwht,
});
