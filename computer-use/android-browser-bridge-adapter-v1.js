'use strict';

const crypto = require('node:crypto');
const { createUiState } = require('./runtime-v1');

const TERMINAL = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'verification_failed']);
const DEFAULT_TIMEOUT_MS = 20_000;

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
  const serialized = JSON.stringify(action);
  if (/(sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN .*PRIVATE KEY-----|Bearer\\s+[A-Za-z0-9._~-]{12,})/.test(serialized)) {
    throw new Error('secret_material_rejected');
  }
  if (action.risk === 'high_risk_write' || action.risk === 'destructive') {
    throw new Error('approval_required');
  }

  switch (action.action) {
    case 'click':
      return { action: { action: 'click', nodeId: action.target?.ref } };
    case 'type': {
      const ref = action.metadata?.credential_ref;
      if (ref) {
        if (typeof ref !== 'string' || !/^secret:\/\/rwht\/[A-Za-z0-9._:-]+$/.test(ref)) {
          throw new Error('credential_ref_invalid');
        }
        return {
          action: { action: 'type', nodeId: action.target?.ref },
          secret_ref: ref
        };
      }
      return { action: { action: 'type', nodeId: action.target?.ref, text: action.text } };
    }
    case 'press':
      return { action: { action: 'press', keyCode: Number(action.value?.keyCode ?? action.metadata?.keyCode) } };
    case 'scroll':
      return {
        action: {
          action: 'scroll',
          nodeId: action.target?.ref,
          direction: action.value?.direction === 'backward' ? 'backward' : 'forward'
        }
      };
    case 'navigate':
      return { action: { action: 'navigate', url: action.value?.url || action.metadata?.url } };
    case 'wait':
      return { action: { action: 'wait', ms: Number(action.value?.ms ?? action.metadata?.ms ?? 500) } };
    case 'select':
      throw new Error('select_not_supported_in_android_bridge_v1');
    default:
      throw new Error('unsupported_action');
  }
}

function extractBridgePayload(result) {
  return result?.result?.result
    || result?.result?.payload
    || result?.result
    || null;
}

function createAndroidBrowserBridgeAdapter({
  deviceDispatcher,
  device_id,
  timeout_ms = DEFAULT_TIMEOUT_MS
} = {}) {
  if (!deviceDispatcher || typeof deviceDispatcher.execute !== 'function') {
    throw new TypeError('deviceDispatcher required');
  }
  if (!device_id || typeof device_id !== 'string') throw new TypeError('device_id required');

  async function request(missionId, stepId, payload, timeoutMs = timeout_ms) {
    const step = {
      id: stepId,
      operation: 'computer.use.android',
      command: JSON.stringify(payload),
      timeout_ms: timeoutMs,
      target: { device_id }
    };

    const result = await deviceDispatcher.execute({ missionId, step, attempt: 1 });
    if (!result || !TERMINAL.has(result.status)) {
      return { status: 'failed', reason: 'invalid_device_result' };
    }
    if (result.status !== 'succeeded') {
      return { status: result.status, reason: result.stderr || 'android_browser_bridge_failed', raw: result };
    }
    return { status: 'succeeded', payload: extractBridgePayload(result), raw: result };
  }

  return Object.freeze({
    adapter_id: 'aria-android-browser-bridge-v1',
    executor_type: 'android-accessibility',

    async observe({ mission_id } = {}) {
      if (!mission_id) throw new TypeError('mission_id required');
      const result = await request(
        mission_id,
        mission_id + '-observe-' + crypto.randomUUID().slice(0, 8),
        { action: 'observe' }
      );
      if (result.status !== 'succeeded') return result;
      return toUiState(result.payload);
    },

    async execute({ mission_id, action } = {}) {
      if (!mission_id || !action) throw new TypeError('mission_id and action required');

      let jobPayload;
      try {
        jobPayload = actionToNative(action);
      } catch (error) {
        return {
          status: 'blocked',
          reason: error instanceof Error ? error.message : 'action_translation_failed'
        };
      }

      const result = await request(
        mission_id,
        action.id || mission_id + '-action-' + crypto.randomUUID().slice(0, 8),
        jobPayload
      );

      if (result.status !== 'succeeded') return result;

      const ui = result.payload?.ui
        ? toUiState(result.payload.ui)
        : null;

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

module.exports = Object.freeze({
  createAndroidBrowserBridgeAdapter,
  toUiState,
  actionToNative,
  flattenTree
});
