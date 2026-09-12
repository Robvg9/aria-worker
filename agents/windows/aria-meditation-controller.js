'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createFileStateStore, createMeditationController } = require('../../autonomy/meditation-ia-controller');

const ROOT = process.env.ARIA_WINDOWS_AGENT_ROOT || path.resolve(__dirname, '..', '..', '..');
const MED_ROOT = process.env.ARIA_MEDITATION_ROOT || path.join(ROOT, 'Runtime', 'meditation');
const LOG_PATH = process.env.ARIA_MEDITATION_LOG || path.join(MED_ROOT, 'ARIA-Meditation-IA.txt');
const CONTROL_PORT = Number(process.env.ARIA_MEDITATION_PORT || 45873);
const GATEWAY_URL = process.env.ARIA_DEVICE_GATEWAY_URL || '';
const DEVICE_TOKEN = process.env.ARIA_DEVICE_TOKEN || '';
const DEVICE_ID = process.env.ARIA_DEVICE_ID || '';

async function appendLog(message) {
  await fsp.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fsp.appendFile(LOG_PATH, `${new Date().toISOString()} ${message}\r\n`, 'utf8');
}

async function ensureLogFile() {
  await fsp.mkdir(path.dirname(LOG_PATH), { recursive: true });
  try { await fsp.access(LOG_PATH, fs.constants.F_OK); }
  catch {
    await fsp.writeFile(LOG_PATH, 'ARIA — MEDITACIÓN IA\r\n======================\r\n\r\nINSTRUCCIONES:\r\nEscribe una línea nueva: CERRAR | PAUSA | AVANZA | ESTADO\r\n\r\n', 'utf8');
  }
}

function openNotepad() {
  return new Promise(resolve => {
    const p = spawn('notepad.exe', [LOG_PATH], { detached: true, windowsHide: false, stdio: 'ignore' });
    p.unref();
    resolve({ status: 'started', pid: p.pid });
  });
}

async function readCommands(offset = 0) {
  await ensureLogFile();
  const text = await fsp.readFile(LOG_PATH, 'utf8');
  const safeOffset = offset > text.length ? 0 : Math.max(0, offset);
  const segment = text.slice(safeOffset);
  const entries = [];
  let cursor = safeOffset;
  for (const raw of segment.split(/\r?\n/)) {
    const line = raw.trim();
    cursor += raw.length + 1;
    const match = line.match(/^>\s*(START|AVANZA|CONTINUA|PAUSA|CERRAR|DETENER|ESTADO)\s*$/i) || line.match(/^(START|AVANZA|CONTINUA|PAUSA|CERRAR|DETENER|ESTADO)$/i);
    if (match) entries.push({ command: match[1].toUpperCase(), next_offset: cursor });
  }
  return { entries, next_offset: text.length };
}

async function isUserIdle() {
  const ps = '[Add-Type -Name LastInput -Namespace ARIA -MemberDefinition \'[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }\' -PassThru; $i=New-Object ARIA.LastInput+LASTINPUTINFO; $i.cbSize=[Runtime.InteropServices.Marshal]::SizeOf($i); [ARIA.LastInput]::GetLastInputInfo([ref]$i)|Out-Null; [int](([Environment]::TickCount - $i.dwTime)/1000)';
  return await new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
    let out = '';
    p.stdout.on('data', c => { out += c.toString(); });
    p.on('close', code => resolve(code === 0 && Number(out.trim()) >= Number(process.env.ARIA_MEDITATION_MIN_IDLE_SECONDS || 45)));
    setTimeout(() => { try { p.kill(); } catch {} resolve(false); }, 5000);
  });
}

async function requestTick({ state, reason, tick }) {
  if (!GATEWAY_URL || !DEVICE_TOKEN || !DEVICE_ID) return { status: 'blocked', error: 'meditation_gateway_config_missing' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${GATEWAY_URL.replace(/\/$/, '')}/v1/meditation/tick`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${DEVICE_TOKEN}`, 'x-aria-device-id': DEVICE_ID },
      body: JSON.stringify({ device_id: DEVICE_ID, session_id: state.session_id, reason, tick }),
      signal: controller.signal
    });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { status: 'failed', error: 'gateway_invalid_json' }; }
    return response.ok ? body : { status: 'failed', error: body?.error || `gateway_${response.status}` };
  } catch (error) {
    return { status: 'failed', error: String(error?.message || error) };
  } finally { clearTimeout(timer); }
}

async function checkpoint(record) {
  const p = path.join(MED_ROOT, 'checkpoint.json');
  await fsp.mkdir(path.dirname(p), { recursive: true });
  const normalized = { version: 'aria-meditation-checkpoint-v1', recorded_at: new Date().toISOString(), ...record };
  await fsp.writeFile(p, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function startControlServer(controller) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${CONTROL_PORT}`);
    const respond = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); };
    try {
      if (req.method === 'GET' && url.pathname === '/status') return respond(200, controller.status());
      if (req.method === 'GET' && url.pathname === '/log') { await ensureLogFile(); return respond(200, { path: LOG_PATH, content: await fsp.readFile(LOG_PATH, 'utf8') }); }
      if (req.method === 'POST' && url.pathname === '/start') return respond(200, await controller.start());
      if (req.method === 'POST' && url.pathname === '/pause') return respond(200, await controller.pause());
      if (req.method === 'POST' && url.pathname === '/resume') return respond(200, await controller.resume());
      if (req.method === 'POST' && url.pathname === '/stop') return respond(200, await controller.stop());
      return respond(404, { error: 'not_found' });
    } catch (error) { return respond(500, { error: String(error?.message || error) }); }
  });
  server.on('error', error => { void appendLog(`CONTROL_SERVER_ERROR ${error.message}`); });
  server.listen(CONTROL_PORT, '127.0.0.1', () => { void appendLog(`CONTROL_SERVER online=http://127.0.0.1:${CONTROL_PORT}`); });
  return server;
}

function createWindowsMeditationController() {
  const store = createFileStateStore({ root_dir: MED_ROOT });
  const core = createMeditationController({
    stateStore: store,
    commandSource: { read: readCommands },
    log: appendLog,
    requestTick,
    checkpoint,
    isUserIdle,
    ensureNotepad: async () => { await ensureLogFile(); return openNotepad(); },
    heartbeat_ms: Number(process.env.ARIA_MEDITATION_HEARTBEAT_MS || 30_000),
    min_idle_seconds: Number(process.env.ARIA_MEDITATION_MIN_IDLE_SECONDS || 45),
    onMissionEvent: async event => { await appendLog(`EVENT ${JSON.stringify(event)}`); },
    onModeChange: async value => { await appendLog(`MODE ${value.mode}`); }
  });
  const server = startControlServer(core);
  return Object.freeze({ core, server, event: appendLog, start: core.start, pause: core.pause, resume: core.resume, stop: core.stop, shutdown: async () => { await core.shutdown(); server.close(); } });
}

module.exports = Object.freeze({ createWindowsMeditationController, constants: Object.freeze({ ROOT, MED_ROOT, LOG_PATH, CONTROL_PORT }) });
