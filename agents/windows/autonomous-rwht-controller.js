'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
let executeWindowsDesktop;
try {
  ({ executeWindowsDesktop } = require('./windows-desktop-adapter'));
} catch (error) {
  if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  ({ executeWindowsDesktop } = require('../../computer-use/windows-desktop-adapter'));
}

const VERSION = 'aria-windows-autonomous-rwht-v1.2.3';
const OLLAMA_URL = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'qwen3:4b';
let CDP_BASE_URL = process.env.ARIA_CHROME_CDP_URL || 'http://127.0.0.1:9222';
let managedBrowser = null;

const INTERACTIVE_ROLES = new Set([
  'button', 'hyperlink', 'tab', 'menuitem', 'checkbox', 'radiobutton',
  'combobox', 'edit', 'listitem', 'treeitem', 'splitbutton'
]);

const BLOCKED = /(delete|remove|destroy|reset|revoke|logout|log\s*out|sign\s*out|clear\s+all|wipe|trash|borrar|eliminar|destruir|restablecer|revocar|cerrar\s+sesión|cerrar\s+sesion|salir|vaciar)/i;
const WINDOW_CHROME = /(MinimizeWindowButton|MaximizeWindowButton|CloseWindowButton|RestoreWindowButton|SystemMenu|Minimize|Maximize|Close)/i;
const NATIVE_BROWSER_UI = /(Instalar PWA|Adjuntar archivo|choose file|seleccionar archivo)/i;
const MUTATING = /\b(?:crear|create|guardar|save|enviar|send|ejecutar|execute|run|deploy|actualizar|update|confirmar|confirm|publicar|publish|submit|start|iniciar)\b/i;
const SECRET = /(password|passwd|token|secret|api[_ -]?key|private\s+key|bearer|credential|contraseña|contrasena)/i;

function nodeLabel(node) {
  return String((node && (node.name || node.label || node.text)) || '').trim();
}

function isInteractive(node) {
  return Boolean(
    node &&
    node.visible !== false &&
    node.enabled !== false &&
    !WINDOW_CHROME.test(nodeLabel(node)) &&
    !NATIVE_BROWSER_UI.test(nodeLabel(node)) &&
    !MUTATING.test(nodeLabel(node)) &&
    INTERACTIVE_ROLES.has(String(node.role || '').toLowerCase())
  );
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function controlKey(_screenHash, nodeId) {
  const raw = String(nodeId);
  const stable = raw.replace(/^cdp-\d+-/, 'cdp-');
  return hash([stable]);
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
            source: node.attributes.source == null ? null : String(node.attributes.source),
            cdp_index: Number.isInteger(node.attributes.cdp_index) ? node.attributes.cdp_index : null,
            identity: node.attributes.identity == null ? null : String(node.attributes.identity),
            href: node.attributes.href == null ? null : String(node.attributes.href),
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

function findBrowserExecutable() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:\\Program Files\\TotalCommanderPlus\\Soft\\Principal\\Chrome\\chrome.exe',
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function findCdpPage() {
  try {
    const tabs = await fetchJsonWithTimeout(CDP_BASE_URL + '/json', 2500);
    return tabs.find((tab) => tab && tab.type === 'page' && String(tab.url || '').includes('aria.robvg9.workers.dev/pwa')) || null;
  } catch {
    return null;
  }
}

async function ensureCdpBrowser(startUrl) {
  const existing = await findCdpPage();
  if (existing) return { ready: true, managed: false, page: existing };

  if (managedBrowser && managedBrowser.child && !managedBrowser.child.killed) {
    return { ready: false, managed: true, error: 'managed_browser_page_unavailable' };
  }

  const executable = findBrowserExecutable();
  if (!executable) return { ready: false, error: 'browser_executable_not_found' };

  let port;
  try {
    port = await findFreePort();
  } catch (error) {
    return { ready: false, error: 'cdp_port_unavailable:' + String(error && error.message || error) };
  }

  const userDataDir = path.join(os.tmpdir(), 'aria-rwht-cdp-' + process.pid + '-' + Date.now());
  fs.mkdirSync(userDataDir, { recursive: true });

  const child = spawn(executable, [
    '--remote-debugging-port=' + port,
    '--remote-debugging-address=127.0.0.1',
    '--user-data-dir=' + userDataDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
    startUrl || 'https://aria.robvg9.workers.dev/pwa/#home',
  ], { windowsHide: false, stdio: 'ignore' });

  managedBrowser = { child, userDataDir, port };
  CDP_BASE_URL = 'http://127.0.0.1:' + port;

  child.once('exit', () => {
    if (managedBrowser && managedBrowser.child === child) managedBrowser = null;
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const page = await findCdpPage();
    if (page) return { ready: true, managed: true, page };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ready: false, managed: true, error: 'chrome_cdp_page_timeout' };
}

async function cleanupManagedBrowser() {
  const browser = managedBrowser;
  managedBrowser = null;
  if (!browser || !browser.child || browser.child.killed) return;
  try {
    const killer = spawn('taskkill.exe', ['/PID', String(browser.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    killer.unref();
  } catch {}
  try {
    fs.rmSync(browser.userDataDir, { recursive: true, force: true });
  } catch {}
}

async function fetchJsonWithTimeout(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error('http_' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function chromeCdpCall(method, params = {}) {
  const tabs = await fetchJsonWithTimeout(CDP_BASE_URL + '/json', 5000);
  const page = tabs.find((tab) => tab && tab.type === 'page' && String(tab.url || '').includes('aria.robvg9.workers.dev/pwa'));
  if (!page || !page.webSocketDebuggerUrl || typeof WebSocket !== 'function') {
    throw new Error('chrome_cdp_page_unavailable');
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const response = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      finish(reject, new Error('chrome_cdp_timeout'));
    }, 7000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method, params }));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data || ''));
        if (msg.id !== 1) return;
        if (msg.error) return finish(reject, new Error(String(msg.error.message || 'chrome_cdp_error')));
        finish(resolve, msg.result);
      } catch (error) {
        finish(reject, error);
      }
    };
    ws.onerror = () => finish(reject, new Error('chrome_cdp_socket_error'));
  });
  try { ws.close(); } catch {}
  return response || {};
}

async function chromeCdpInteractiveNodes() {
  try {
    const tabs = await fetchJsonWithTimeout('CDP_BASE_URL + '/json', 5000);
    const page = tabs.find((t) => t && t.type === 'page' && String(t.url || '').includes('aria.robvg9.workers.dev/pwa'));
    if (!page || !page.webSocketDebuggerUrl || typeof WebSocket !== 'function') return [];
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const response = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
      const timer = setTimeout(() => { try { ws.close(); } catch {} finish(reject, new Error('chrome_cdp_timeout')); }, 7000);
      ws.onopen = () => ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          returnByValue: true,
          awaitPromise: true,
          expression: `(function(){
            const visible = function(el){ const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>1 && r.height>1 && s.visibility!=='hidden' && s.display!=='none' && Number(s.opacity||1)>0; };
            const text = function(el){ return String(el.getAttribute('aria-label') || el.innerText || el.value || el.name || el.placeholder || '').trim().replace(/\\s+/g,' ').slice(0,240); };
            const role = function(el){ const explicit=String(el.getAttribute('role')||'').toLowerCase(); if(explicit) return explicit==='link'?'hyperlink':explicit; const tag=el.tagName.toLowerCase(); if(tag==='button') return 'button'; if(tag==='a') return 'hyperlink'; if(tag==='input'||tag==='textarea') return 'edit'; if(tag==='select') return 'combobox'; return 'custom'; };
            const selector='button,a,input,textarea,select,[role],[tabindex]';
            const els=Array.from(document.querySelectorAll(selector)).filter(visible).filter(function(el){return el.getAttribute('tabindex') !== '-1';});
            return els.map(function(el,i){ const r=el.getBoundingClientRect(); const label=text(el); const roleValue=role(el); const identity=(el.getAttribute('data-testid')||el.id||el.getAttribute('aria-label')||el.name||label||el.tagName)+'|'+roleValue; return {id:'cdp-'+i+'-'+(el.getAttribute('data-testid')||el.getAttribute('aria-label')||el.tagName),role:roleValue,name:label,text:label,label:label,enabled:!el.disabled,visible:true,attributes:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),source:'chrome-cdp',cdp_index:i,identity:identity,href:el.getAttribute('href')}}; }).slice(0,250);
          })()`
        }
      }));
      ws.onmessage = (event) => { try { const msg=JSON.parse(String(event.data||'')); if(msg.id!==1) return; msg.error ? finish(reject,new Error(String(msg.error.message||'chrome_cdp_error'))) : finish(resolve,msg.result); } catch(e) { finish(reject,e); } };
      ws.onerror = () => finish(reject,new Error('chrome_cdp_socket_error'));
    });
    try { ws.close(); } catch {}
    const value = response && response.result && response.result.value;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}


async function chromeCdpAct(node, action, text) {
  let index = Number.isInteger(node && node.attributes && node.attributes.cdp_index) ? node.attributes.cdp_index : -1;
  if (index < 0) {
    const match = String(node && node.id || '').match(/^cdp-(\d+)-/);
    if (match) index = Number(match[1]);
  }
  if (!Number.isInteger(index) || index < 0) throw new Error('chrome_cdp_target_index_missing');
  const selector = 'button,a,input,textarea,select,[role],[tabindex]';
  const expression = "(function(){" +
    "const visible=function(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity||1)>0;};" +
    "const els=Array.from(document.querySelectorAll(" + JSON.stringify(selector) + ")).filter(visible).filter(function(el){return el.getAttribute('tabindex') !== '-1';});" +
    "const el=els[" + String(index) + "];" +
    "if(!el) return {ok:false,error:'chrome_cdp_target_missing'};" +
    "if(" + JSON.stringify(action) + "==='click'){el.focus();el.click();return {ok:true};}" +
    "if(" + JSON.stringify(action) + "==='double_click'){el.focus();el.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window}));return {ok:true};}" +
    "if(" + JSON.stringify(action) + "==='type'){el.focus();const value=" + JSON.stringify(String(text == null ? '' : text)) + ";if('value' in el){const proto=Object.getPrototypeOf(el);const d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set)d.set.call(el,value);else el.value=value;}else if(el.isContentEditable){el.textContent=value;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true};}" +
    "return {ok:false,error:'chrome_cdp_action_unsupported'};" +
  "})()";
  const response = await chromeCdpCall('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression });
  return response && response.result && response.result.value || { ok:false, error:'chrome_cdp_empty_result' };
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
  if (!node) return { status: 'failed', error: 'target_not_found' };
  if (node.attributes && node.attributes.source === 'chrome-cdp') {
    const cdp = await chromeCdpAct(node, decision.action, decision.text).catch((error) => ({ ok: false, error: String(error && error.message || error) }));
    return { status: cdp && cdp.ok ? 'succeeded' : 'failed', error: cdp && cdp.error || null, method: 'chrome-cdp' };
  }
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

  const focusTargets = ['chrome', 'msedge'];
  const results = [];
  let focused = false;

  for (const process of focusTargets) {
    const focus = await adapter({ action: 'focus', process });
    results.push({
      action: 'focus',
      process,
      status: focus && focus.status || 'unknown',
      error: focus && focus.error || null,
    });
    if (focus && focus.status === 'succeeded') {
      focused = true;
      break;
    }
  }

  if (!focused) {
    const launched = await adapter({ action: 'open', path: url });
    results.push({
      action: 'open',
      status: launched && launched.status || 'unknown',
      error: launched && launched.error || null,
      url,
    });
    if (!launched || launched.status !== 'succeeded') {
      return { status: 'failed', results };
    }
    await adapter({ action: 'wait', ms: 2500 });
  }

  const navigationSteps = [
    { action: 'hotkey', keys: ['CTRL', 'L'] },
    { action: 'type', text: url },
    { action: 'keypress', key: 'ENTER' },
    { action: 'wait', ms: 1800 },
  ];

  for (const step of navigationSteps) {
    const result = await adapter(step);
    results.push({
      action: step.action,
      status: result && result.status || 'unknown',
      error: result && result.error || null,
    });
    if (!result || result.status !== 'succeeded') {
      return { status: 'failed', results };
    }
  }

  return { status: 'succeeded', results };
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
  const controlDiscoveryVerify = /RWHT_CONTROL_DISCOVERY_VERIFY/i.test(goal);
  const fullPwaCoverageMode = /(LIBRO\s+MAESTRO|ARIA\s+PWA|PWA\s+LIVE(?:\s+de)?\s+ARIA)/i.test(goal);
  const requiredRoutes = fullPwaCoverageMode
    ? ['#home', '#chat', '#mission', '#projects', '#meditation', '#capabilities', '#settings']
    : [];
  const visitedRoutes = new Set();
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

  const currentRoute = async () => {
    try {
      const response = await chromeCdpCall('Runtime.evaluate', {
        returnByValue: true,
        expression: 'location.hash || "#home"',
      });
      return String(response?.result?.value || '#home');
    } catch {
      return null;
    }
  };

  const navigateToRoute = async (route) => {
    if (!startUrl || !route) return { status: 'skipped', route };
    const base = String(startUrl).split('#')[0];
    const url = base + route;
    try {
      await chromeCdpCall('Page.navigate', { url });
      await new Promise((resolve) => setTimeout(resolve, 900));
      const observedRoute = await currentRoute();
      if (observedRoute === route) {
        visitedRoutes.add(route);
        return { status: 'succeeded', method: 'chrome-cdp', url, route, observed_route: observedRoute };
      }
    } catch {}
    const fallback = await navigate(adapter, url);
    if (fallback.status !== 'succeeded') return { ...fallback, route, url };
    await new Promise((resolve) => setTimeout(resolve, 700));
    const observedRoute = await currentRoute();
    if (observedRoute === route) {
      visitedRoutes.add(route);
      return { ...fallback, status: 'succeeded', route, url, observed_route: observedRoute };
    }
    return { ...fallback, status: 'failed', route, url, error: 'route_navigation_not_verified', observed_route: observedRoute };

  };

  const cdpBootstrap = await ensureCdpBrowser(startUrl).catch((error) => ({
    ready: false,
    error: String(error && error.message || error),
  }));
  await emitProgress('computer_use_browser_ready', {
    status: cdpBootstrap.ready ? 'succeeded' : 'failed',
    managed_browser: cdpBootstrap.managed === true,
    cdp_base_url: CDP_BASE_URL,
    error: cdpBootstrap.error || null,
  });
  const navigation = await (async () => {
    if (!startUrl) return { status: 'skipped' };
    const result = await navigateToRoute('#home');
    if (result.status === 'succeeded') visitedRoutes.add('#home');
    return result;
  })().catch((error) => ({
    status: 'failed',
    error: String(error && error.message || error),
  }));

  const observe = async (reason = 'initial') => {
    await ensureCdpBrowser(startUrl).catch(() => null);
    await emitProgress('computer_use_observation_started', {
      reason,
      full_pwa_coverage: fullPwaCoverageMode,
      required_routes_total: requiredRoutes.length,
      required_routes_visited: visitedRoutes.size,
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const cdpNodes = await chromeCdpInteractiveNodes();
        if (cdpNodes.length) {
          const sanitized = sanitize({
            surface: 'windows-chrome',
            title: null,
            url: startUrl,
            nodes: cdpNodes,
            metadata: { source: 'chrome-cdp', chrome_cdp_primary: true, cdp_node_count: cdpNodes.length, cdp_attempt: attempt },
          });
          await emitProgress('computer_use_observation_completed', {
            reason,
            status: 'succeeded',
            title: sanitized.title,
            surface: sanitized.surface,
            control_count: sanitized.nodes.length,
            observation_source: 'chrome-cdp',
            cdp_attempt: attempt,
          });
          return sanitized;
        }
      } catch {}
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 300));
    }
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
      observation_source: sanitized.metadata && sanitized.metadata.source || 'windows-uia',
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
    const routeNow = await currentRoute();
    if (fullPwaCoverageMode && routeNow && requiredRoutes.includes(routeNow)) {
      visitedRoutes.add(routeNow);
    }

    const screenHash = hash(compact(current));
    screensSeen.add(screenHash);

    const safe = safeNodes(current);
    safe.forEach((node) => discoveredControls.add(controlKey(screenHash, node.id)));

    const pending = safe.filter((node) => {
      const key = controlKey(screenHash, node.id);
      return !exercisedControls.has(key) && !blockedControls.has(key);
    });

    if (fullPwaCoverageMode && pending.length === 0) {
      const nextRoute = requiredRoutes.find((route) => !visitedRoutes.has(route));
      if (nextRoute) {
        const routeResult = await navigateToRoute(nextRoute);
        evidence.push({
          step,
          kind: 'route_navigation',
          route: nextRoute,
          result_status: routeResult.status,
          verified: routeResult.status === 'succeeded',
          timestamp: new Date().toISOString(),
        });
        await emitProgress('computer_use_route_navigation_completed', {
          step,
          route: nextRoute,
          status: routeResult.status,
          required_routes_total: requiredRoutes.length,
          required_routes_visited: visitedRoutes.size,
        }, step);
        if (routeResult.status === 'succeeded') {
          current = await observe('ruta ' + nextRoute);
          noProgressStreak = 0;
          continue;
        }
      }
    }

    let decision = null;
    let decisionSource = 'qwen3';
    let modelError = null;

    const fastCoverageMode = /(RWHT\s+PC\s+E2E|RWHT_CONTROL_DISCOVERY_VERIFY|ARIA\s+PWA|PWA\s+LIVE(?:\s+de)?\s+ARIA)/i.test(goal);
    if (!fastCoverageMode) {
      try {
        decision = normalizeDecision(await model(
          promptFor(goal, current, capabilities, history, screenHash, exercisedControls),
          5000
        ));
      } catch (error) {
        decisionSource = 'fallback';
        modelError = String(error && error.message || error);
      }
    } else {
      decisionSource = 'deterministic-coverage';
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
      if ((!fullPwaCoverageMode || visitedRoutes.size >= requiredRoutes.length) && pending.length === 0 && noProgressStreak >= 2 && screensSeen.size > 1) {
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

    const verifiedActionCount = evidence.filter((item) => item.step && item.action && item.verified === true).length;
    if (
      fullPwaCoverageMode
      && visitedRoutes.size >= requiredRoutes.length
      && executionVerified
      && safeNodes(current).every((node) =>
        exercisedControls.has(controlKey(afterHash || beforeHash, node.id)) ||
        blockedControls.has(controlKey(afterHash || beforeHash, node.id))
      )
      && noProgressStreak >= 2
      && screensSeen.size > 1
    ) {
      finishReason = 'coverage_complete';
      break;
    }

    if (!fullPwaCoverageMode && controlDiscoveryVerify && exercisedControls.size >= 5 && screensSeen.size >= 2) {
      finishReason = 'control_discovery_verified';
      break;
    }

    if (
      !fullPwaCoverageMode
      && executionVerified
      && safeNodes(current).every((node) =>
        exercisedControls.has(controlKey(afterHash || beforeHash, node.id)) ||
        blockedControls.has(controlKey(afterHash || beforeHash, node.id))
      )
      && noProgressStreak >= 2
      && screensSeen.size > 1
    ) {
      finishReason = 'coverage_complete';
      break;
    }
  }

  if (finishReason === 'runtime_limit' && exercisedControls.size > 0) {
    finishReason = 'bounded_run_exhausted';
  }

  const verifiedActions = evidence.filter((item) => item.step && item.action && item.verified === true);
  const coverageRatio = discoveredControls.size
    ? Number((exercisedControls.size / discoveredControls.size).toFixed(3))
    : 0;
  const routeCoverageComplete = !fullPwaCoverageMode || visitedRoutes.size >= requiredRoutes.length;
  const complete = (finishReason === 'coverage_complete' || finishReason === 'control_discovery_verified') && routeCoverageComplete;
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
    full_pwa_coverage: fullPwaCoverageMode,
    required_routes_total: requiredRoutes.length,
    required_routes_visited: visitedRoutes.size,
    route_gate_verified: routeCoverageComplete,
  };

  await cleanupManagedBrowser();

  return {
    ...summary,
    verified: complete,
    full_pwa_coverage: fullPwaCoverageMode,
    required_routes_total: requiredRoutes.length,
    required_routes_visited: visitedRoutes.size,
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
// Diagnostic trigger 2026-10-01: no runtime behavior change.
