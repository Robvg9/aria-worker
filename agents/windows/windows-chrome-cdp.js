'use strict';

const VERSION = 'aria-windows-chrome-cdp-v1.0.0';
const CDP_URL = 'http://127.0.0.1:9222';
const DEFAULT_START_URL = 'https://aria.robvg9.workers.dev/pwa/';
const DEFAULT_ALLOWED_HOSTS = new Set(['aria.robvg9.workers.dev']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

async function getJson(path) {
  const response = await fetch(CDP_URL + path);
  if (!response.ok) throw new Error('cdp_http_' + response.status);
  return response.json();
}

function ensureWebSocket() {
  if (typeof WebSocket !== 'function') throw new Error('websocket_unavailable');
}

function hostAllowed(url, hosts) {
  try { return hosts.has(new URL(url).hostname); } catch { return false; }
}

async function createRpcConnection(url) {
  ensureWebSocket();
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)));
    else entry.resolve(message);
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('cdp_ws_open_timeout')), 5000);
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    ws.addEventListener('error', (error) => {
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error('cdp_ws_open_failed'));
    }, { once: true });
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('cdp_rpc_timeout:' + method));
    }, 15000);
    pending.set(id, {
      resolve: (message) => { clearTimeout(timeout); resolve(message); },
      reject: (error) => { clearTimeout(timeout); reject(error); },
    });
    ws.send(JSON.stringify({ id, method, params }));
  });

  return { ws, call, close: () => { try { ws.close(); } catch {} } };
}

async function browserVersion() {
  return getJson('/json/version');
}

async function listTargets() {
  return getJson('/json/list');
}

async function createTarget(url) {
  const browser = await createRpcConnection((await browserVersion()).webSocketDebuggerUrl);
  try {
    return (await browser.call('Target.createTarget', { url })).result.targetId;
  } finally {
    browser.close();
  }
}

async function findTarget(allowedHosts) {
  const targets = await listTargets();
  return targets.find((target) =>
    target &&
    target.type === 'page' &&
    typeof target.webSocketDebuggerUrl === 'string' &&
    hostAllowed(target.url || '', allowedHosts)
  ) || null;
}

const OBSERVE_EXPRESSION = [
  '(() => {',
  'const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden"; };',
  'const roleOf = (el) => { const r = String(el.getAttribute("role") || "").trim().toLowerCase(); if (r === "link") return "hyperlink"; if (r === "textbox") return "edit"; if (r === "radio") return "radiobutton"; if (r) return r; if (el.tagName === "BUTTON") return "button"; if (el.tagName === "A") return "hyperlink"; if (el.tagName === "TEXTAREA") return "edit"; if (el.tagName === "SELECT") return "combobox"; if (el.tagName === "INPUT") return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radiobutton" : "edit"; return el.isContentEditable ? "edit" : "pane"; };',
  'const labelOf = (el) => String(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.value || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 240);',
  'const cssPath = (el) => { if (el.id) return "#" + CSS.escape(el.id); const path = []; let current = el; while (current && current.nodeType === 1 && current !== document.documentElement) { let part = current.tagName.toLowerCase(); const parent = current.parentElement; if (!parent) break; const siblings = [...parent.children].filter((child) => child.tagName === current.tagName); if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")"; path.unshift(part); current = parent; } return path.join(" > "); };',
  'const hash = (value) => { let hash = 2166136261; for (let i = 0; i < value.length; i += 1) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); };',
  'const selectors = "button,a,input,textarea,select,[role=button],[role=tab],[role=checkbox],[role=radio],[role=combobox],[contenteditable=true]";',
  'const elements = [...document.querySelectorAll(selectors)].filter(visible).slice(0, 300);',
  'return elements.map((el, index) => { const rect = el.getBoundingClientRect(); const selector = cssPath(el); const label = labelOf(el); return { id: "cdp-" + index + "-" + hash(selector), role: roleOf(el), name: label, text: label, label, enabled: !el.disabled, visible: true, attributes: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height), selector, tag: el.tagName.toLowerCase() } }; });',
  '})()',
].join('\n');

class ChromeCdpAdapter {
  constructor(options = {}) {
    this.startUrl = options.startUrl || DEFAULT_START_URL;
    this.allowedHosts = new Set(options.allowedHosts || DEFAULT_ALLOWED_HOSTS);
    this.browser = null;
    this.target = null;
    this.rpc = null;
    this.rpcTargetId = null;
  }

  async connect({ createIfMissing = true } = {}) {
    this.browser = await browserVersion();
    this.target = await findTarget(this.allowedHosts);

    if (!this.target && createIfMissing) {
      await createTarget(this.startUrl);
      for (let index = 0; index < 10 && !this.target; index += 1) {
        await sleep(500);
        this.target = await findTarget(this.allowedHosts);
      }
    }

    if (!this.target) throw new Error('aria_cdp_target_not_found');

    if (!this.rpc || this.rpcTargetId !== this.target.id) {
      if (this.rpc) this.rpc.close();
      this.rpc = await createRpcConnection(this.target.webSocketDebuggerUrl);
      this.rpcTargetId = this.target.id;
      await this.rpc.call('Runtime.enable');
      await this.rpc.call('Page.enable');
    }

    return this;
  }

  async evaluate(expression) {
    await this.connect();
    const result = await this.rpc.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.text || 'cdp_runtime_exception');
    }
    return result.result?.result?.value;
  }

  async observe() {
    await this.connect();
    const expression =
      'JSON.stringify({' +
      'title:document.title,' +
      'url:location.href,' +
      'ready:document.readyState,' +
      'text:(document.body?.innerText || "").slice(0,12000),' +
      'nodes:' + OBSERVE_EXPRESSION +
      '})';

    const value = JSON.parse(await this.evaluate(expression));

    return {
      status: 'succeeded',
      action: 'observe',
      ui: {
        version: 'ui-state-v1.1.0',
        surface: 'browser-dom',
        url: value.url || null,
        title: value.title || null,
        focused_id: null,
        nodes: Array.isArray(value.nodes) ? value.nodes : [],
        body_text: value.text || '',
        metadata: {
          source: 'chrome-cdp',
          browser_version: this.browser?.Browser || null,
          target_id: this.target?.id || null,
          node_count: Array.isArray(value.nodes) ? value.nodes.length : 0,
        },
      },
      version: VERSION,
    };
  }

  async action(request = {}) {
    const action = String(request.action || '');

    if (action === 'wait') {
      await sleep(request.ms);
      return { status: 'succeeded', action, version: VERSION };
    }

    await this.connect();

    if (action === 'navigate') {
      const url = String(request.url || '');
      if (!hostAllowed(url, this.allowedHosts)) {
        return { status: 'failed', error: 'cdp_navigation_host_blocked' };
      }
      await this.rpc.call('Page.navigate', { url });
      await sleep(1200);
      return { status: 'succeeded', action, url, version: VERSION };
    }

    if (action === 'focus') {
      const browser = await createRpcConnection((await browserVersion()).webSocketDebuggerUrl);
      try {
        await browser.call('Target.activateTarget', { targetId: this.target.id });
      } finally {
        browser.close();
      }
      return { status: 'succeeded', action, version: VERSION };
    }

    if (action === 'back') {
      await this.evaluate('history.back()');
      return { status: 'succeeded', action, version: VERSION };
    }

    if (action === 'scroll') {
      const delta = Math.round(Number.isFinite(Number(request.delta)) ? Number(request.delta) : 650);
      const selector = typeof request.selector === 'string' ? request.selector : null;
      const expression = selector
        ? '(() => { const el=document.querySelector(' + JSON.stringify(selector) + '); if(!el)return false; el.scrollBy(0,' + delta + '); return true; })()'
        : '(() => { window.scrollBy(0,' + delta + '); return true; })()';
      const ok = await this.evaluate(expression);
      return { status: ok ? 'succeeded' : 'failed', error: ok ? null : 'cdp_scroll_target_missing', action, version: VERSION };
    }

    if (action === 'screenshot') {
      const result = await this.rpc.call('Page.captureScreenshot', { format: 'png' });
      return {
        status: 'succeeded',
        action,
        screenshot_base64: result.result?.data || null,
        version: VERSION,
      };
    }

    if (action === 'keypress') {
      const key = String(request.key || '');
      const mapping = {
        ENTER: ['Enter', 'Enter', 13, 13],
        ESCAPE: ['Escape', 'Escape', 27, 27],
        TAB: ['Tab', 'Tab', 9, 9],
        BACKSPACE: ['Backspace', 'Backspace', 8, 8],
        ARROWDOWN: ['ArrowDown', 'ArrowDown', 40, 40],
        ARROWUP: ['ArrowUp', 'ArrowUp', 38, 38],
      };
      const entry = mapping[key.toUpperCase()] || [key, key, 0, 0];
      await this.rpc.call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: entry[0],
        code: entry[1],
        keyCode: entry[2],
        windowsVirtualKeyCode: entry[3],
      });
      await this.rpc.call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: entry[0],
        code: entry[1],
        keyCode: entry[2],
        windowsVirtualKeyCode: entry[3],
      });
      return { status: 'succeeded', action, key, version: VERSION };
    }

    if (action === 'hotkey') {
      const keys = Array.isArray(request.keys) ? request.keys.map(String) : [];
      if (!keys.length) return { status: 'failed', error: 'cdp_hotkey_invalid' };
      const modifiersMap = { CTRL: 2, ALT: 1, SHIFT: 8, META: 4 };
      let modifiers = 0;
      for (const key of keys) modifiers |= modifiersMap[key.toUpperCase()] || 0;
      const mainKey = keys.find((key) => !modifiersMap[key.toUpperCase()]) || keys.at(-1);
      await this.rpc.call('Input.dispatchKeyEvent', { type: 'keyDown', key: mainKey, modifiers });
      await this.rpc.call('Input.dispatchKeyEvent', { type: 'keyUp', key: mainKey, modifiers });
      return { status: 'succeeded', action, keys, version: VERSION };
    }

    if (['click', 'double_click', 'type'].includes(action)) {
      const selector = typeof request.selector === 'string' ? request.selector : null;
      if (!selector) return { status: 'failed', error: 'cdp_selector_required' };

      if (action === 'type') {
        const text = String(request.text ?? '');
        const expression =
          '(() => {' +
          'const el=document.querySelector(' + JSON.stringify(selector) + ');' +
          'if(!el)return {ok:false,error:"element_not_found"};' +
          'el.focus();' +
          'if(el.isContentEditable){el.textContent=' + JSON.stringify(text) + ';}' +
          'else { const prototype=Object.getPrototypeOf(el); const descriptor=Object.getOwnPropertyDescriptor(prototype,"value"); if(descriptor && typeof descriptor.set==="function") descriptor.set.call(el,' + JSON.stringify(text) + '); else el.value=' + JSON.stringify(text) + '; }' +
          'el.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:' + JSON.stringify(text) + '}));' +
          'el.dispatchEvent(new Event("change",{bubbles:true}));' +
          'return {ok:true};' +
          '})()';
        const value = await this.evaluate(expression);
        return { status: value?.ok ? 'succeeded' : 'failed', error: value?.error || null, action, version: VERSION };
      }

      const expression =
        '(() => {' +
        'const el=document.querySelector(' + JSON.stringify(selector) + ');' +
        'if(!el)return {ok:false,error:"element_not_found"};' +
        'el.scrollIntoView({block:"center",inline:"center"});' +
        'el.focus?.();' +
        (action === 'double_click'
          ? 'el.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,cancelable:true,view:window}));el.click?.();'
          : 'el.click?.();') +
        'return {ok:true};' +
        '})()';

      const value = await this.evaluate(expression);
      return { status: value?.ok ? 'succeeded' : 'failed', error: value?.error || null, action, version: VERSION };
    }

    return { status: 'failed', error: 'cdp_action_unsupported:' + action, version: VERSION };
  }
}

async function createWindowsChromeCdpAdapter(options = {}) {
  const adapter = new ChromeCdpAdapter(options);
  try {
    await adapter.connect({ createIfMissing: options.createIfMissing !== false });
    return adapter;
  } catch (error) {
    return {
      status: 'unavailable',
      version: VERSION,
      error: error instanceof Error ? error.message : String(error),
      execute: async () => ({ status: 'failed', error: 'chrome_cdp_unavailable' }),
    };
  }
}

async function executeWindowsChromeCdp(request, options = {}) {
  const adapter = await createWindowsChromeCdpAdapter(options);
  return adapter?.status === 'unavailable'
    ? adapter.execute(request, options)
    : adapter.action(request, options);
}

module.exports = Object.freeze({
  VERSION,
  ChromeCdpAdapter,
  createWindowsChromeCdpAdapter,
  executeWindowsChromeCdp,
});
