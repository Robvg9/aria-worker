'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { executeWindowsDesktop, VERSION } = require('../computer-use/windows-desktop-adapter');

function runPs(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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

(async () => {
  console.log(`[physical-e2e] adapter=${VERSION}`);

  const screen = JSON.parse(await runPs("Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; @{left=$b.Left;top=$b.Top;width=$b.Width;height=$b.Height}|ConvertTo-Json -Compress"));
  assert.ok(screen.width > 0 && screen.height > 0, 'screen unavailable');

  const opened = await action('open-notepad', { action: 'open', path: 'notepad.exe' });
  await action('wait-after-open', { action: 'wait', ms: 250 }, 5000);
  await action('focus-notepad', { action: 'focus', process: 'notepad' });
  await action('type-plain', { action: 'type', text: 'ARIA DESKTOP E2E PASS' });
  await action('keypress-enter', { action: 'keypress', key: 'ENTER' });
  await action('type-url-text', { action: 'type', text: 'https://example.com/?aria=1' });
  await action('hotkey-select-all', { action: 'hotkey', keys: ['CTRL', 'A'] });
  await action('type-final-marker', { action: 'type', text: 'ARIA_KEYBOARD_OK' });
  await action('keypress-home', { action: 'keypress', key: 'HOME' });

  const rect = JSON.parse(await runPs("Add-Type @'\nusing System; using System.Runtime.InteropServices; public static class WinRect { [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out RECT r); public struct RECT { public int L,T,R,B; } }\n'@; $p=Get-Process -Name notepad | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object -First 1; $r=New-Object WinRect+RECT; [WinRect]::GetWindowRect($p.MainWindowHandle,[ref]$r)|Out-Null; @{x1=$r.L+80;y1=$r.T+120;x2=$r.L+220;y2=$r.T+120}|ConvertTo-Json -Compress"));
  await action('move', { action: 'move', x: rect.x1, y: rect.y1 });
  await action('click', { action: 'click', x: rect.x1, y: rect.y1 });
  await action('double-click', { action: 'double_click', x: rect.x1, y: rect.y1 });
  await action('drag', { action: 'drag', x1: rect.x1, y1: rect.y1, x2: rect.x2, y2: rect.y2, duration_ms: 120 });
  await action('scroll', { action: 'scroll', delta: 240 });
  await action('wait', { action: 'wait', ms: 100 }, 5000);

  const shot = await action('screenshot', { action: 'screenshot' }, 30000);
  assert.ok(typeof shot.screenshot_base64 === 'string' && shot.screenshot_base64.length > 1000, 'screenshot payload missing');
  const observed = await action('observe', { action: 'observe' }, 30000);
  assert.ok(observed.stdout || observed.ui || observed.nodes, 'observe returned no UI evidence');

  const chrome = await action('open-chrome', { action: 'open', path: 'chrome.exe' });
  await action('wait-chrome', { action: 'wait', ms: 800 }, 5000);
  await action('focus-chrome', { action: 'focus', process: 'chrome' });
  await action('hotkey-ctrl-l', { action: 'hotkey', keys: ['CTRL', 'L'] });
  await action('type-chrome-url', { action: 'type', text: 'https://example.com/?aria=e2e' });
  await action('enter-chrome-url', { action: 'keypress', key: 'ENTER' });
  await action('wait-page', { action: 'wait', ms: 1000 }, 5000);
  await action('observe-chrome', { action: 'observe' }, 30000);
  await action('screenshot-chrome', { action: 'screenshot' }, 30000);

  console.log(`[physical-e2e] PASS adapter=${VERSION} screen=${screen.width}x${screen.height} notepad_pid=${opened.pid} chrome_pid=${chrome.pid}`);
})().catch((error) => {
  console.error(`[physical-e2e] FAIL ${error.stack || error.message}`);
  process.exit(1);
});
