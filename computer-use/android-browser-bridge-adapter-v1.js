'use strict';

const crypto = require('node:crypto');
const { createUiState } = require('./runtime-v1');

const TERMINAL = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'verification_failed']);
const DEFAULT_PORT = 43817;
const DEFAULT_TIMEOUT_MS = 20_000;

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\"'\\"'") + "'";
}

function flattenTree(root, nodes = [], parentId = null) {
  if (!root || typeof root !== 'object') return nodes;
  const id = String(root.id || nodes.length);
  const attrs = {
    className: root.className ?? null,
    packageName: root.packageName ?? null,
    clickable: root.clickable === true,
    focused: root.focused === true,
    scrollable: root.scrollable === true,
    bounds: root.bounds ?? null
  };
  nodes.push({
    id,
    role: root.role || 'text',
    name: root.name ?? root.contentDescription ?? null,
    text: root.text ?? null,
    label: root.label ?? null,
    enabled: root.enabled !== false,
    visible: root.visible !== false,
    parent_id: parentId,
    attributes: attrs
  });
  if (Array.isArray(root.children)) {
    for (const child of root.children) flattenTree(child, nodes, id);
  }
  return nodes;
}

function toUiState(payload) {
  if (!payload || typeof payload !== 'object' || !payload.root) {
    return createUiState({
      surface: 'android-browser',
      nodes: [],
      metadata: { bridge_error: payload?.error || null }
    });
  }

  const nodes = flattenTree(payload.root);
  const focused = nodes.find(n => n.attributes?.focused);
  const bodyText = nodes
    .filter(n => n.visible && typeof n.text === 'string' && n.text.trim())
    .map(n => n.text.trim())
    .join('\n')
    .slice(0, 30_000);

  return createUiState({
    surface: 'android-browser',
    url: null,
    title: null,
    focused_id: focused?.id || null,
    nodes,
    metadata: {
      package_name: payload.packageName || null,
      evidence_hash: payload.evidence_hash || null,
      body_text: bodyText
    }
  });
}

function actionToNative(action) {
  if (!action || typeof action !== 'object') throw new TypeError('action_required');

  switch (action.action) {
    case 'click':
      return { action: 'click', nodeId: action.target?.ref };
    case 'type':
      if (action.metadata?.credential_ref) throw new Error('credential_ref_requires_secure_device_transport');
      return { action: 'type', nodeId: action.target?.ref, text: action.text };
    case 'press':
      return { action: 'press', keyCode: Number(action.value?.keyCode ?? action.metadata?.keyCode) };
    case 'scroll':
      return {
        action: 'scroll',
        nodeId: action.target?.ref,
        direction: action.value?.direction === 'backward' ? 'backward' : 'forward'
      };
    case 'navigate':
      return { action: 'navigate', url: action.value?.url || action.metadata?.url };
    case 'wait':
      return { action: 'wait', ms: Number(action.value?.ms ?? action.metadata?.ms ?? 500) };
    case 'select':
      throw new Error('select_not_supported_in_android_bridge_v1');
    default:
      throw new Error('unsupported_action');
  }
}

function parseShellResponse(stdout) {
  const raw = String(stdout || '');
  const marker = '\nARIA_HTTP_STATUS:';
  const index = raw.lastIndexOf(marker);
  if (index < 0) return { status: null, body: raw.trim() };
  const body = raw.slice(0, index).trim();
  const status = Number(raw.slice(index + marker.length).trim());
  return { status: Number.isInteger(status) ? status : null, body };
}

function createAndroidBrowserBridgeAdapter({
  deviceDispatcher,
  device_id,
  bridge_port = DEFAULT_PORT,
  shell_timeout_ms = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!deviceDispatcher || typeof deviceDispatcher.execute !== 'function') {
    throw new TypeError('deviceDispatcher required');
  }
  if (!device_id || typeof device_id !== 'string') throw new TypeError('device_id required');

  async function request(missionId, stepId, method, path, body = null, timeoutMs = shell_timeout_ms) {
    const args = [
      'curl', '-sS',
      '--connect-timeout', '3',
      '--max-time', String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      '-H', shellQuote('Content-Type: application/json'),
      '-X', shellQuote(method),
      shellQuote('http://127.0.0.1:' + bridge_port + path),
      '--write-out', shellQuote('\\nARIA_HTTP_STATUS:%{http_code}\\n')
    ];
    if (body != null) args.splice(args.length - 1, 0, '--data', shellQuote(JSON.stringify(body)));
    const command = args.join(' ');
    const step = {
      id: stepId,
      operation: 'shell.execute',
      command,
      timeout_ms: timeoutMs,
      target: { device_id }
    };

    const result = await deviceDispatcher.execute({ missionId, step, attempt: 1 });
    if (!result || !TERMINAL.has(result.status)) {
      return { status: 'failed', reason: 'invalid_device_result' };
    }
    if (result.status !== 'succeeded') {
      return { status: result.status, reason: result.stderr || 'device_shell_failed', raw: result };
    }

    const parsed = parseShellResponse(result.stdout);
    let payload = null;
    try { payload = parsed.body ? JSON.parse(parsed.body) : null; } catch {
      return { status: 'failed', reason: 'bridge_invalid_json' };
    }

    if (parsed.status && parsed.status >= 400) {
      return {
        status: parsed.status === 409 ? 'failed' : 'blocked',
        reason: payload?.error || payload?.reason || 'bridge_http_error',
        raw: payload
      };
    }

    return { status: payload?.ok === false ? 'failed' : 'succeeded', payload };
  }

  return Object.freeze({
    adapter_id: 'aria-android-browser-bridge-v1',
    executor_type: 'android-accessibility',
    async observe({ mission_id } = {}) {
      if (!mission_id) throw new TypeError('mission_id required');
      const result = await request(
        mission_id,
        mission_id + '-observe-' + crypto.randomUUID().slice(0, 8),
        'GET',
        '/v1/observe'
      );
      if (result.status !== 'succeeded') return result;
      try {
        return toUiState(result.payload);
      } catch {
        return { status: 'failed', reason: 'ui_state_normalization_failed' };
      }
    },

    async execute({ mission_id, action } = {}) {
      if (!mission_id || !action) throw new TypeError('mission_id and action required');

      let nativeAction;
      try {
        nativeAction = actionToNative(action);
      } catch (error) {
        return {
          status: 'blocked',
          reason: error instanceof Error ? error.message : 'action_translation_failed'
        };
      }

      const result = await request(
        mission_id,
        action.id || mission_id + '-action-' + crypto.randomUUID().slice(0, 8),
        'POST',
        '/v1/action',
        nativeAction
      );

      if (result.status !== 'succeeded') return result;

      let ui = null;
      if (result.payload?.ui) {
        ui = toUiState(result.payload.ui);
      }
      return {
        status: 'succeeded',
        ui,
        metadata: {
          bridge: 'android-accessibility',
          evidence_hash: result.payload?.evidence_hash || null
        }
      };
    }
  });
}

module.exports = Object.freeze({ createAndroidBrowserBridgeAdapter, toUiState, actionToNative, flattenTree });
