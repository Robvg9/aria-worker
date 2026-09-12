'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { executeWindowsDesktop, VERSION } = require('../computer-use/windows-desktop-adapter');

function runPs(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`PowerShell ${code}: ${stderr || stdout}`)));
  });
}

async function action(name, payload, timeout = 30000) {
  const result = await executeWindowsDesktop(payload, { timeout_ms: timeout });
  console.log(`[physical-e2e] ${name}: ${JSON.stringify({ status: result.status, action: result.action, error: result.error || null, version: result.version || VERSION })}`);
  assert.equal(result.status, 'succeeded', `${name} failed: ${result.error || result.stderr || 'unknown error'}`);
  return result;
}

async function expectFailure(name, payload, timeout = 30000, expectedStatus = 'timeout') {
  const result = await executeWindowsDesktop(payload, { timeout_ms: timeout });
  console.log(`[physical-e2e] ${name}: ${JSON.stringify({ status: result.status, action: result.action, error: result.error || null, version: result.version || VERSION })}`);
  assert.equal(result.status, expectedStatus, `${name} expected ${expectedStatus} but got ${result.status}: ${result.error || ''}`);
  return result;
}

async function observeHasText(observed, text) {
  const needle = String(text).toLowerCase();
  const nodes = Array.isArray(observed?.ui?.nodes) ? observed.ui.nodes : [];
  return nodes.some((node) => String(node?.name || '').toLowerCase().includes(needle));
}

(async () => {
  console.log(`[physical-e2e] certification=101 adapter=${VERSION}`);

  const screen = JSON.parse(await runPs("Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; @{left=$b.Left;top=$b.Top;width=$b.Width;height=$b.Height}|ConvertTo-Json -Compress"));
  assert.ok(screen.width > 0 && screen.height > 0, 'screen unavailable');

  let notepadPid = null;
  let chromePids = [];

  try {
    const opened = await action('open-notepad', { action: 'open', path: 'notepad.exe' });
    notepadPid = opened.pid;
    await action('wait-after-open', { action: 'wait', ms: 250 }, 5000);
    await action('focus-notepad', { action: 'focus', process: 'notepad' });
    await action('type-plain', { action: 'type', text: 'Te Amo Evelyn' });
    await action('keypress-enter', { action: 'keypress', key: 'ENTER' });
    await action('hotkey-select-all', { action: 'hotkey', keys: ['CTRL', 'A'] });
    await action('type-final-marker', { action: 'type', text: 'ARIA DESKTOP 101 PASS' });
    await action('keypress-home', { action: 'keypress', key: 'HOME' });

    const rect = JSON.parse(await runPs("Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class WinRect { [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int L,T,R,B; } }\n'@; $p=Get-Process -Name notepad | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1; $r=New-Object WinRect+RECT; [WinRect]::GetWindowRect($p.MainWindowHandle,[ref]$r)|Out-Null; @{x1=$r.L+80;y1=$r.T+120;x2=$r.L+220;y2=$r.T+120}|ConvertTo-Json -Compress"));
    await action('move', { action: 'move', x: rect.x1, y: rect.y1 });
    await action('click', { action: 'click', x: rect.x1, y: rect.y1 });
    await action('double-click', { action: 'double_click', x: rect.x1, y: rect.y1 });
    await action('drag', { action: 'drag', x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2, duration_ms: 120 });
    await action('scroll', { action: 'scroll', delta: 240 });
    await action('wait', { action: 'wait', ms: 100 }, 5000);

    const observedNotepad = await action('observe-notepad', { action: 'observe' }, 30000);
    assert.ok(Array.isArray(observedNotepad?.ui?.nodes) && observedNotepad.ui.nodes.length > 0, 'observe returned no UI evidence');
    assert.ok(await observeHasText(observedNotepad, 'Notepad'), 'observe did not expose Notepad UI');
    const shotNotepad = await action('screenshot-notepad', { action: 'screenshot' }, 30000);
    assert.ok(typeof shotNotepad.screenshot_base64 === 'string' && shotNotepad.screenshot_base64.length > 1000, 'screenshot payload missing');

    await expectFailure('controlled-timeout', { action: 'wait', ms: 2500 }, 1000, 'timeout');
    await action('recovery-wait', { action: 'wait', ms: 100 }, 5000);
    await action('recovery-focus-notepad', { action: 'focus', process: 'notepad' });
    const recovered = await action('recovery-observe', { action: 'observe' }, 30000);
    assert.ok(await observeHasText(recovered, 'Notepad'), 'recovery lost desktop control');

    const chrome = await action('open-chrome', { action: 'open', path: 'chrome.exe' });
    chromePids.push(chrome.pid);
    await action('wait-chrome', { action: 'wait', ms: 1000 }, 5000);
    await action('focus-chrome', { action: 'focus', process: 'chrome' });
    await action('hotkey-ctrl-l', { action: 'hotkey', keys: ['CTRL', 'L'] });
    await action('type-chrome-url', { action: 'type', text: 'https://example.com/?aria=101' });
    await action('enter-chrome-url', { action: 'keypress', key: 'ENTER' });
    await action('wait-page', { action: 'wait', ms: 1500 }, 5000);
    const observedChrome = await action('observe-chrome', { action: 'observe' }, 30000);
    assert.ok(observedChrome?.ui?.nodes?.length > 0, 'Chrome observe returned no UI');
    const shotChrome = await action('screenshot-chrome', { action: 'screenshot' }, 30000);
    assert.ok(typeof shotChrome.screenshot_base64 === 'string' && shotChrome.screenshot_base64.length > 1000, 'Chrome screenshot missing');

    await action('focus-notepad-final', { action: 'focus', process: 'notepad' });
    await action('keypress-end-final', { action: 'keypress', key: 'END' });
    await action('type-final-proof', { action: 'type', text: ' | RECOVERY_OK' });
    const finalObserve = await action('final-observe', { action: 'observe' }, 30000);
    assert.ok(await observeHasText(finalObserve, 'Notepad'), 'final desktop verification failed');

    console.log(`[physical-e2e] PASS_101 adapter=${VERSION} screen=${screen.width}x${screen.height} notepad_pid=${notepadPid} chrome_pid=${chrome.pid}`);
  } finally {
    await runPs("Get-Process -Id " + (notepadPid || 0) + " -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue").catch(() => {});
    console.log(`[physical-e2e] cleanup notepad_pid=${notepadPid || 'none'} chrome_pids=${chromePids.length}`);
  }
})().catch((error) => {
  console.error(`[physical-e2e] FAIL ${error.stack || error.message}`);
  process.exit(1);
});

// Fresh physical-certification trigger: 101% recovery + semantic E2E.
