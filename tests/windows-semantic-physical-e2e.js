'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');

const PWA_URL = 'https://aria.robvg9.workers.dev/pwa/';
const ADAPTER = require('../computer-use/windows-desktop-adapter');
const { createUiState, createComputerRuntime } = require('../computer-use/runtime-v1');

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function getJson(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('http_' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('http_timeout')));
  });
}

async function waitForPage(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tabs = await getJson('http://127.0.0.1:' + port + '/json');
      const page = tabs.find((tab) => tab && tab.type === 'page' && tab.url);
      if (page) return page;
    } catch {}
    await wait(400);
  }
  throw new Error('chrome_cdp_page_timeout');
}

function evaluate(tab, expression, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket !== 'function') return reject(new Error('websocket_unavailable'));
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      reject(new Error('cdp_evaluate_timeout'));
    }, timeoutMs);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      error ? reject(error) : resolve(value);
    };
    ws.onopen = () => ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { returnByValue: true, awaitPromise: true, expression }
    }));
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data || ''));
        if (message.id !== 1) return;
        if (message.error) return finish(new Error(String(message.error.message || 'cdp_error')));
        finish(null, message.result && message.result.result && message.result.result.value);
      } catch (error) {
        finish(error);
      }
    };
    ws.onerror = () => finish(new Error('cdp_socket_error'));
  });
}

function findChromeExecutable() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\TotalCommanderPlus\\Soft\\Principal\\Chrome\\chrome.exe'
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(found, 'Chrome executable not found');
  return found;
}

async function main() {
  const port = await freePort();
  const userDataDir = path.join(os.tmpdir(), 'aria-pc006-semantic-' + process.pid);
  fs.mkdirSync(userDataDir, { recursive: true });
  const chromePath = findChromeExecutable();
  let chrome = null;
  try {
    chrome = spawn(chromePath, [
      '--remote-debugging-port=' + port,
      '--remote-debugging-address=127.0.0.1',
      '--user-data-dir=' + userDataDir,
      '--no-first-run',
      '--no-default-browser-check',
      '--new-window',
      PWA_URL
    ], { windowsHide: false, stdio: 'ignore' });

    const tab = await waitForPage(port);
    const controls = await (async () => {
      const deadline = Date.now() + 30000;
      const expression = 'Array.from(document.querySelectorAll("button,input,textarea,select,a,[role],[tabindex]")).map(function(e){return {role:(e.getAttribute("role")||e.tagName.toLowerCase()),name:String(e.getAttribute("aria-label")||e.innerText||e.value||e.name||e.placeholder||"").trim().replace(/\\s+/g," "),disabled:!!e.disabled};}).filter(function(x){return x.name;})';
      while (Date.now() < deadline) {
        try {
          const value = await evaluate(tab, expression);
          if (Array.isArray(value) && value.some((x) => x.name === 'ENTRAR EN ARIA')) return value;
        } catch {}
        await wait(500);
      }
      throw new Error('PWA semantic login control not mounted');
    })();

    assert.ok(controls.some((x) => x.name === 'ENTRAR EN ARIA'), 'semantic PWA control missing');
    const initialUi = createUiState({
      surface: 'windows-chrome',
      url: PWA_URL,
      title: 'ARIA — Centro de Mando',
      nodes: controls.map((node, i) => ({
        id: 'initial-' + i + '-' + node.name,
        role: node.role === 'input' ? 'edit' : node.role,
        name: node.name,
        text: node.name,
        label: node.name,
        enabled: !node.disabled,
        visible: true,
        attributes: { source: 'chrome-cdp' }
      }))
    });

    let observeCount = 0;
    const adapter = {
      async observe() {
        observeCount += 1;
        const value = await evaluate(tab, '({url:location.href,title:document.title,nodes:Array.from(document.querySelectorAll("button,input,textarea,select,a,[role],[tabindex]")).map(function(e,i){const role=e.getAttribute("role")||e.tagName.toLowerCase();const name=String(e.getAttribute("aria-label")||e.innerText||e.value||e.name||e.placeholder||"").trim().replace(/\\s+/g," ");return {id:"observe-"+i+"-"+name,role:role==="input"?"edit":role,name:name,text:name,label:name,enabled:!e.disabled,visible:true,attributes:{source:"chrome-cdp"}};}).filter(function(x){return x.name;})})');
        return createUiState(value);
      },
      async execute({ action }) {
        return ADAPTER.executeWindowsDesktop({
          action: action.action,
          target: action.target
        }, { timeout_ms: 30000 });
      }
    };

    const runtime = createComputerRuntime({ adapter });
    const result = await runtime.executeMission({
      mission_id: 'pc006-semantic-physical-e2e-' + Date.now(),
      ui: initialUi,
      intent: 'Probar clic semántico PWA sin coordenadas absolutas',
      target: { role: 'button', name: 'ENTRAR EN ARIA', action: 'click' },
      expectation: { present: [{ role: 'button', name: 'ENTRANDO…' }] },
      recovery: false
    });

    assert.equal(result.status, 'succeeded', JSON.stringify(result));
    assert.equal(result.verification.valid, true, JSON.stringify(result));
    assert.equal(result.action.target.query.role, 'button');
    assert.equal(result.action.target.query.name, 'ENTRAR EN ARIA');
    assert.equal(result.action.target.page_url, PWA_URL);
    assert.equal(result.action.target.surface, 'windows-chrome');
    assert.equal(result.action.target.ref.startsWith('initial-'), true);
    assert.match(JSON.stringify(result.ui), /ENTRANDO/);

    console.log('BUG-PC-006 SEMANTIC PHYSICAL E2E: PASS');
    console.log(JSON.stringify({
      browser: 'Chrome',
      url: PWA_URL,
      executor_method: result.ui.metadata && result.ui.metadata.source,
      semantic_target: result.action.target.query,
      page_binding: result.action.target.page_url,
      verification: result.verification,
      observe_count: observeCount,
      adapter_version: ADAPTER.VERSION
    }));
  } finally {
    if (chrome && Number.isInteger(chrome.pid)) {
      try { execFileSync('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => {
  console.error('BUG-PC-006 SEMANTIC PHYSICAL E2E: FAIL');
  console.error(error && error.stack || error);
  process.exit(1);
});
