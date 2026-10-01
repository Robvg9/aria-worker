'use strict';

// Official runtime-sync trigger: changes in computer-use invoke aria-windows-runtime-repair.yml.
// Do not remove this marker without preserving an equivalent trigger path.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { executeChromeSemanticAction } = require('./windows-chrome-semantic-action');

const VERSION = 'aria-windows-desktop-v1.9';
const MAX_TEXT = 32 * 1024;
const MAX_SCREENSHOT_B64 = 8 * 1024 * 1024;
const MAX_HOTKEY_KEYS = 6;
const ACTIONS = new Set([
  'screenshot', 'observe', 'open', 'click', 'double_click', 'move', 'drag',
  'type', 'keypress', 'hotkey', 'scroll', 'focus', 'wait'
]);
const RUNNER = path.join(__dirname, 'windows-desktop-runner.ps1');
const UIA_SCRIPT = path.join(__dirname, 'windows-ui-automation.ps1');
const UIA_ACTION_SCRIPT = path.join(__dirname, 'windows-ui-automation-action.ps1');
const HOTKEY_SCRIPT = path.join(__dirname, 'windows-hotkey-runner.ps1');

function semanticQueryFromTarget(target) {
  const value = target && typeof target === 'object' ? target : null;
  const query = value && value.query && typeof value.query === 'object' ? value.query : value;
  if (!query || !['role','name','text','label','attribute'].some((key) => query[key] != null)) {
    throw new Error('desktop_semantic_target_invalid');
  }
  return query;
}

async function executeSemanticClick(payload, timeoutMs) {
  const uia = await spawnPowerShell(
    ['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',UIA_ACTION_SCRIPT],
    payload,
    timeoutMs
  );
  if (uia.status === 'succeeded') {
    const observed = await spawnPowerShell(
      ['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',UIA_SCRIPT],
      { action: 'observe' },
      timeoutMs
    );
    return { ...uia, ui: observed.status === 'succeeded' ? observed.ui : null, method: 'windows-uia-semantic' };
  }
  const cdp = await executeChromeSemanticAction(payload, { timeout_ms: Math.min(15000, Math.max(1000, timeoutMs || 7000)) });
  if (cdp.status === 'succeeded') return cdp;
  return {
    status: 'failed',
    action: payload.action,
    version: VERSION,
    error: 'semantic_executor_failed:' + (uia.error || 'uia_not_found') + ';cdp=' + (cdp.error || 'cdp_not_available'),
    methods_tried: ['windows-uia-semantic','chrome-cdp-semantic']
  };
}

function validateRequest(request = {}) {
  if (!request || typeof request !== 'object') throw new Error('desktop_request_invalid');
  const action = String(request.action || '');
  if (!ACTIONS.has(action)) throw new Error('desktop_action_unsupported');
  if (action === 'type' && (typeof request.text !== 'string' || request.text.length === 0 || request.text.length > MAX_TEXT)) throw new Error('desktop_type_invalid');
  if (action === 'open' && (typeof request.path !== 'string' || !request.path.trim())) throw new Error('desktop_open_invalid');
  if (action === 'focus' && (typeof request.process !== 'string' || !request.process.trim())) throw new Error('desktop_focus_invalid');
  if ((action === 'click' || action === 'double_click') && !(Number.isInteger(request.x) && Number.isInteger(request.y))) {
    if (request.target == null) throw new Error('desktop_pointer_or_semantic_target_invalid');
    semanticQueryFromTarget(request.target);
  }
  if (action === 'move' && (!Number.isInteger(request.x) || !Number.isInteger(request.y))) throw new Error('desktop_pointer_invalid');
  if (action === 'drag' && (![request.x1, request.y1, request.x2, request.y2].every(Number.isInteger))) throw new Error('desktop_drag_invalid');
  if (action === 'keypress' && (typeof request.key !== 'string' || !request.key.trim())) throw new Error('desktop_keypress_invalid');
  if (action === 'hotkey' && (!Array.isArray(request.keys) || request.keys.length < 2 || request.keys.length > MAX_HOTKEY_KEYS || request.keys.some(key => typeof key !== 'string' || !key.trim()))) throw new Error('desktop_hotkey_invalid');
  if (action === 'scroll' && !Number.isInteger(request.delta)) throw new Error('desktop_scroll_invalid');
  if (action === 'wait' && (!Number.isInteger(request.ms) || request.ms < 0 || request.ms > 60000)) throw new Error('desktop_wait_invalid');
  return Object.freeze({ ...request, action });
}

function killProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.unref();
  } catch (_) {}
}

function spawnPowerShell(args, payload, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish({ status: 'timeout', action: payload.action, error: 'desktop_timeout', version: VERSION });
    }, Math.max(1000, timeoutMs));
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_SCREENSHOT_B64 + 100000) killProcessTree(child.pid);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 16384) stderr = stderr.slice(-16384);
    });
    child.on('error', (error) => finish({ status: 'failed', action: payload.action, error: String(error?.message || error), version: VERSION }));
    child.on('close', (code) => {
      const text = stdout.trim();
      if (text) {
        try {
          const result = JSON.parse(text);
          const normalized = { ...result, action: result.action || payload.action, version: VERSION };
          if (normalized.screenshot_base64 && normalized.screenshot_base64.length > MAX_SCREENSHOT_B64) return finish({ status: 'failed', action: payload.action, error: 'desktop_screenshot_too_large', version: VERSION });
          if (normalized.status === 'succeeded' && code === 0) return finish(normalized);
          return finish({ status: 'failed', action: payload.action, exit_code: code, error: normalized.error || stderr || ('powershell_exit_' + code), version: VERSION });
        } catch (_) {}
      }
      finish({ status: 'failed', action: payload.action, exit_code: code, error: stderr || 'desktop_invalid_result:empty_or_unparseable', stdout: text.slice(-4096), version: VERSION });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function openDirectly(payload) {
  return new Promise((resolve) => {
    const value = String(payload.path || '');
    const isUrl = /^https?:\/\//i.test(value);
    const child = isUrl
      ? spawn('cmd.exe', ['/c', 'start', '', value], { windowsHide: false, stdio: 'ignore' })
      : spawn(value, [], { windowsHide: false, stdio: 'ignore' });
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish({ status: 'failed', action: 'open', path: value, error: 'desktop_open_timeout', version: VERSION }), 7000);
    child.once('error', (error) => {
      clearTimeout(timer);
      finish({ status: 'failed', action: 'open', path: value, error: String(error?.message || error), version: VERSION });
    });
    child.once('spawn', () => {
      clearTimeout(timer);
      child.unref();
      finish({
        status: 'succeeded',
        action: 'open',
        pid: child.pid,
        path: value,
        version: VERSION,
        method: isUrl ? 'cmd_start_url' : 'node_spawn',
      });
    });
  });
}

async function executeWindowsDesktop(request, { timeout_ms = 30_000 } = {}) {
  const payload = validateRequest(request);
  if (payload.action === 'open') return openDirectly(payload);
  if ((payload.action === 'click' || payload.action === 'double_click') && payload.target && !(Number.isInteger(payload.x) && Number.isInteger(payload.y))) {
    return executeSemanticClick(payload, timeout_ms);
  }
  if (payload.action === 'wait') {
    const startedAt = Date.now();
    const budget = Math.max(1000, timeout_ms);
    if (payload.ms > budget) {
      await new Promise((resolve) => setTimeout(resolve, budget));
      return { status: 'timeout', action: 'wait', ms: payload.ms, timeout_ms: budget, elapsed_ms: Date.now() - startedAt, error: 'desktop_timeout', version: VERSION, method: 'node_timer' };
    }
    await new Promise((resolve) => setTimeout(resolve, payload.ms));
    return { status: 'succeeded', action: 'wait', ms: payload.ms, elapsed_ms: Date.now() - startedAt, version: VERSION, method: 'node_timer' };
  }
  const args = payload.action === 'observe'
    ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', UIA_SCRIPT]
    : payload.action === 'hotkey'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', HOTKEY_SCRIPT]
      : ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', RUNNER];
  return spawnPowerShell(args, payload, timeout_ms);
}

module.exports = Object.freeze({ VERSION, ACTIONS, RUNNER, UIA_SCRIPT, UIA_ACTION_SCRIPT, HOTKEY_SCRIPT, validateRequest, executeWindowsDesktop, semanticQueryFromTarget });
