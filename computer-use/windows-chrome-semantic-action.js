'use strict';

function getCdpUrl() { return String(process.env.ARIA_CHROME_CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, ''); }
const BLOCKED = /(delete|remove|destroy|reset|revoke|logout|log\s*out|sign\s*out|clear\s+all|wipe|trash|borrar|eliminar|destruir|restablecer|revocar|cerrar\s+sesión|cerrar\s+sesion|salir|vaciar)/i;

function labelOf(el) {
  return String(
    el.getAttribute('aria-label') ||
    el.innerText ||
    el.value ||
    el.name ||
    el.placeholder ||
    ''
  ).trim().replace(/\s+/g, ' ').slice(0, 240);
}

function roleOf(el) {
  const explicit = String(el.getAttribute('role') || '').toLowerCase();
  if (explicit) return explicit === 'link' ? 'hyperlink' : explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'hyperlink';
  if (tag === 'input' || tag === 'textarea') return 'edit';
  if (tag === 'select') return 'combobox';
  return 'custom';
}

function queryMatches(query) {
  const q = query || {};
  return '(function(){' +
    'const q=' + JSON.stringify(q) + ';' +
    'const blocked=' + BLOCKED.toString() + ';' +
    'const visible=function(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>1&&r.height>1&&s.visibility!=="hidden"&&s.display!=="none"&&Number(s.opacity||1)>0;};' +
    'const label=function(el){return String(el.getAttribute("aria-label")||el.innerText||el.value||el.name||el.placeholder||"").trim().replace(/\\s+/g," ").slice(0,240);};' +
    'const role=function(el){const x=String(el.getAttribute("role")||"").toLowerCase();if(x)return x==="link"?"hyperlink":x;const t=el.tagName.toLowerCase();if(t==="button")return "button";if(t==="a")return "hyperlink";if(t==="input"||t==="textarea")return "edit";if(t==="select")return "combobox";return "custom";};' +
    'const attr=function(el,k){if(k==="automation_id")return el.getAttribute("data-automation-id")||el.id||"";if(k==="control_type")return el.tagName.toLowerCase();return el.getAttribute(k)||"";};' +
    'const ok=function(el){if(!el||!visible(el)||el.disabled)return false;const n=label(el),r=role(el);if(blocked.test(n))return false;' +
      'if(q.role!=null&&r!==String(q.role).toLowerCase())return false;' +
      'if(q.name!=null&&n.toLowerCase()!==String(q.name).toLowerCase())return false;' +
      'if(q.text!=null&&!n.toLowerCase().includes(String(q.text).toLowerCase()))return false;' +
      'if(q.label!=null&&!n.toLowerCase().includes(String(q.label).toLowerCase()))return false;' +
      'if(q.attribute)for(const k of Object.keys(q.attribute)){if(attr(el,k)!==String(q.attribute[k]))return false;}' +
      'return true;};' +
    'const selector="button,a,input,textarea,select,[role],[tabindex]";' +
    'const direct=Array.from(document.querySelectorAll(selector)).filter(ok);' +
    'if(direct.length)return direct.map(function(el){return {element:el,role:role(el),name:label(el)};});' +
    'const roots=Array.from(document.querySelectorAll("*"));' +
    'const resolved=[];const seen=new Set();' +
    'for(const el of roots){' +
      'const text=label(el); if(!text)continue;' +
      'let candidate=el.closest(selector); if(!candidate||!ok(candidate))continue;' +
      'if(q.role!=null&&role(candidate)!==String(q.role).toLowerCase())continue;' +
      'const cn=label(candidate).toLowerCase();' +
      'if(q.name!=null&&cn!==String(q.name).toLowerCase())continue;' +
      'if(q.text!=null&&!cn.includes(String(q.text).toLowerCase()))continue;' +
      'if(q.label!=null&&!cn.includes(String(q.label).toLowerCase()))continue;' +
      'const key=candidate; if(seen.has(key))continue; seen.add(key); resolved.push({element:candidate,role:role(candidate),name:label(candidate)});' +
    '}' +
    'return resolved;' +
  '})()';
}

function cdpCall(method, params, timeoutMs, pageUrl = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let ws = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (ws) ws.close(); } catch {}
      reject(new Error('chrome_cdp_timeout'));
    }, Math.max(1000, timeoutMs || 7000));
    fetch(getCdpUrl() + '/json')
      .then((r) => { if (!r.ok) throw new Error('chrome_cdp_http_' + r.status); return r.json(); })
      .then((tabs) => {
        const pages = Array.isArray(tabs) ? tabs.filter((x) => x && x.type === 'page' && x.webSocketDebuggerUrl) : [];
        const requestedBase = pageUrl ? String(pageUrl).split('#')[0].replace(/\/+$/, '') : null;
        let candidates = requestedBase
          ? pages.filter((x) => String(x.url || '').split('#')[0].replace(/\/+$/, '') === requestedBase)
          : pages;
        if (candidates.length === 0 && requestedBase) {
          candidates = pages.filter((x) => String(x.url || '').includes('aria.robvg9.workers.dev/pwa'));
        }
        if (candidates.length === 0) throw new Error('chrome_cdp_page_unavailable');
        if (candidates.length > 1) {
          candidates.sort((a,b) => Number(String(b.url || '').includes(requestedBase || '')) - Number(String(a.url || '').includes(requestedBase || '')));
          if (String(candidates[0].url || '').split('#')[0].replace(/\/+$/, '') === requestedBase) {
            candidates = [candidates[0]];
          } else {
            throw new Error('chrome_cdp_page_ambiguous');
          }
        }
        const page = candidates[0];
        if (typeof WebSocket !== 'function') throw new Error('chrome_cdp_websocket_unavailable');
        ws = new WebSocket(page.webSocketDebuggerUrl);
        ws.onopen = () => ws.send(JSON.stringify({id:1,method,params:params || {}}));
        ws.onmessage = (event) => {
          if (settled) return;
          try {
            const msg = JSON.parse(String(event.data || ''));
            if (msg.id !== 1) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch {}
            if (msg.error) reject(new Error(String(msg.error.message || 'chrome_cdp_error')));
            else resolve(msg.result || {});
          } catch (error) { settled = true; clearTimeout(timer); try { ws.close(); } catch {} reject(error); }
        };
        ws.onerror = () => { if (!settled) { settled=true; clearTimeout(timer); reject(new Error('chrome_cdp_socket_error')); } };
      })
      .catch((error) => { if (!settled) { settled=true; clearTimeout(timer); reject(error); } });
  });
}

async function executeChromeSemanticAction(payload, {timeout_ms=7000}={}) {
  const fullTarget = payload && payload.target;
  const target = fullTarget && fullTarget.query ? fullTarget.query : fullTarget;
  if (!target || typeof target !== 'object') return {status:'failed',action:payload && payload.action,error:'semantic_target_missing'};
  const pageUrl = fullTarget && (fullTarget.page_url || fullTarget.url) ? String(fullTarget.page_url || fullTarget.url) : null;
  const action = payload.action === 'double_click' ? 'double_click' : 'click';
  const beforeExpression = queryMatches(target);
  const actionExpression = '(async function(){' +
    'const matches=' + beforeExpression + ';' +
    'if(matches.length===0)return {ok:false,error:"semantic_target_not_found"};' +
    'if(matches.length>1)return {ok:false,error:"semantic_target_ambiguous",candidates:matches.slice(0,8).map(function(x){return x.name;})};' +
    'const hit=matches[0];hit.element.focus();' +
    (action === 'double_click'
      ? 'hit.element.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,cancelable:true,view:window}));'
      : 'hit.element.click();') +
    'await new Promise(function(r){setTimeout(r,150)});' +
    'const visible=function(el){const r=el.getBoundingClientRect(),s=getComputedStyle(el);return r.width>1&&r.height>1&&s.visibility!=="hidden"&&s.display!=="none"&&Number(s.opacity||1)>0;};' +
    'const label=function(el){return String(el.getAttribute("aria-label")||el.innerText||el.value||el.name||el.placeholder||"").trim().replace(/\\s+/g," ").slice(0,240);};' +
    'const role=function(el){const x=String(el.getAttribute("role")||"").toLowerCase();if(x)return x==="link"?"hyperlink":x;const t=el.tagName.toLowerCase();if(t==="button")return "button";if(t==="a")return "hyperlink";if(t==="input"||t==="textarea")return "edit";if(t==="select")return "combobox";return "custom";};' +
    'const els=Array.from(document.querySelectorAll("button,a,input,textarea,select,[role],[tabindex]")).filter(visible);' +
    'const nodes=els.slice(0,250).map(function(e,i){const r=e.getBoundingClientRect(),n=label(e),rv=role(e);return {id:"cdp-"+i+"-"+(e.getAttribute("data-testid")||e.getAttribute("aria-label")||e.tagName),role:rv,name:n,text:n,label:n,enabled:!e.disabled,visible:true,attributes:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height),source:"chrome-cdp",cdp_index:i,identity:(e.getAttribute("data-testid")||e.id||e.getAttribute("aria-label")||e.name||n||e.tagName)+"|"+rv,href:e.getAttribute("href")}};});' +
    'return {ok:true,matched:{role:hit.role,name:hit.name},ui:{version:"ui-state-v1.0.0",surface:"windows-chrome",url:location.href,title:document.title,focused_id:null,nodes:nodes,metadata:{source:"chrome-cdp",cdp_node_count:nodes.length}}};' +
  '})()';
  let lastValue = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const result = await cdpCall('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:actionExpression},timeout_ms,pageUrl);
      const value = result && result.result && result.result.value;
      lastValue = value;
      if (value && value.ok === true) {
        return {status:'succeeded',action,method:'chrome-cdp-semantic',version:'aria-windows-chrome-semantic-v1',matched:value.matched,ui:value.ui};
      }
      if (value && value.error !== 'semantic_target_not_found') {
        return {status:'failed',action,error:value.error || 'chrome_cdp_semantic_action_failed',version:'aria-windows-chrome-semantic-v1'};
      }
    } catch (error) {
      lastValue = {error:String(error && error.message || error)};
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return {status:'failed',action,error:lastValue && lastValue.error || 'chrome_cdp_semantic_action_failed',version:'aria-windows-chrome-semantic-v1'};
}

module.exports = Object.freeze({executeChromeSemanticAction});
