'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const VERSION = 'aria-windows-desktop-v1.8';
const MAX_TEXT = 32 * 1024;
const MAX_SCREENSHOT_B64 = 8 * 1024 * 1024;
const MAX_HOTKEY_KEYS = 6;
const ACTIONS = new Set([
  'screenshot', 'observe', 'open', 'click', 'double_click', 'move', 'drag',
  'type', 'keypress', 'hotkey', 'scroll', 'focus', 'wait'
]);
const RUNNER = path.join(__dirname, 'windows-desktop-runner.ps1');
const UIA_SCRIPT = path.join(__dirname, 'windows-ui-automation.ps1');

function validateRequest(request = {}) {
  if (!request || typeof request !== 'object') throw new Error('desktop_request_invalid');
  const action = String(request.action || '');
  if (!ACTIONS.has(action)) throw new Error('desktop_action_unsupported');

  if (action === 'type' && (typeof request.text !== 'string' || request.text.length === 0 || request.text.length > MAX_TEXT)) {
    throw new Error('desktop_type_invalid');
  }
  if (action === 'open' && (typeof request.path !== 'string' || !request.path.trim())) {
    throw new Error('desktop_open_invalid');
  }
  if (action === 'focus' && (typeof request.process !== 'string' || !request.process.trim())) {
    throw new Error('desktop_focus_invalid');
  }
  if ((action === 'click' || action === 'double_click' || action === 'move') &&
      (!Number.isInteger(request.x) || !Number.isInteger(request.y))) {
    throw new Error('desktop_pointer_invalid');
  }
  if (action === 'drag' &&
      (![request.x1, request.y1, request.x2, request.y2].every(Number.isInteger))) {
    throw new Error('desktop_drag_invalid');
  }
  if (action === 'keypress' && (typeof request.key !== 'string' || !request.key.trim())) {
    throw new Error('desktop_keypress_invalid');
  }
  if (action === 'hotkey') {
    if (!Array.isArray(request.keys) || request.keys.length < 2 || request.keys.length > MAX_HOTKEY_KEYS ||
        request.keys.some(key => typeof key !== 'string' || !key.trim())) {
      throw new Error('desktop_hotkey_invalid');
    }
  }
  if (action === 'scroll' && !Number.isInteger(request.delta)) {
    throw new Error('desktop_scroll_invalid');
  }
  if (action === 'wait' && (!Number.isInteger(request.ms) || request.ms < 0 || request.ms > 60_000)) {
    throw new Error('desktop_wait_invalid');
  }

  return Object.freeze({ ...request, action });
}

function spawnPowerShell(args, payload, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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
      try { child.kill(); } catch (_) {}
      finish({ status: 'timeout', action: payload.action, error: 'desktop_timeout', version: VERSION });
    }, Math.max(1000, timeoutMs));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > MAX_SCREENSHOT_B64 + 100000) {
        try { child.kill(); } catch (_) {}
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 16384) stderr = stderr.slice(-16384);
    });
    child.on('error', (error) => finish({
      status: 'failed',
      action: payload.action,
      error: String(error?.message || error),
      version: VERSION,
    }));
    child.on('close', (code) => {
      const text = stdout.trim();
      if (text) {
        try {
          const result = JSON.parse(text);
          const normalized = {
            ...result,
            action: result.action || payload.action,
            version: VERSION,
          };
          if (normalized.screenshot_base64 && normalized.screenshot_base64.length > MAX_SCREENSHOT_B64) {
            return finish({ status: 'failed', action: payload.action, error: 'desktop_screenshot_too_large', version: VERSION });
          }
          if (normalized.status === 'succeeded' && code === 0) return finish(normalized);
          return finish({
            status: 'failed',
            action: payload.action,
            exit_code: code,
            error: normalized.error || stderr || ('powershell_exit_' + code),
            version: VERSION,
          });
        } catch (_) {
          // Fall through to structured failure below.
        }
      }
      finish({
        status: 'failed',
        action: payload.action,
        exit_code: code,
        error: stderr || 'desktop_invalid_result:empty_or_unparseable',
        stdout: text.slice(-4096),
        version: VERSION,
      });
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

async function executeWindowsDesktop(request, { timeout_ms = 30_000 } = {}) {
  const payload = validateRequest(request);
  if (payload.action === 'observe') {
    return spawnPowerShell(
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', UIA_SCRIPT],
      payload,
      timeout_ms,
    );
  }
  return spawnPowerShell(
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', RUNNER],
    payload,
    timeout_ms,
  );
}

module.exports = Object.freeze({ VERSION, ACTIONS, RUNNER, validateRequest, executeWindowsDesktop });
