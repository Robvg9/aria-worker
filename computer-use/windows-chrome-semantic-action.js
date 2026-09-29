'use strict';

const CDP_URL = String(process.env.ARIA_CHROME_CDP_URL || 'http://127.0.0.1:9222').replace(/\/$/, '');
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
    'const ok=function(el){if(!visible(el)||el.disabled)return false;const n=label(el),r=role(el);if(blocked.test(n))return false;' +
      'if(q.role!=null&&r!==String(q.role).toLowerCase())return false;' +
      'if(q.name!=null&&n.toLowerCase()!==String(q.name).toLowerCase())return false;' +
      'if(q.text!=null&&!n.toLowerCase().includes(String(q.text).toLowerCase()))return false;' +
      'if(q.label!=null&&!n.toLowerCase().includes(String(q.label).toLowerCase()))return false;' +
      'if(q.attribute)for(const k of Object.keys(q.attribute)){if(attr(el,k)!==String(q.attribute[k]))return false;}' +
      'return true;};' +
    'const els=Array.from(document.querySelectorAll("button,a,input,textarea,select,[role],[tabindex]")).filter(ok);' +
    'return els.map(function(el){const n=label(el),r=role(el);return {element:el,role:r,name:n};});' +
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
    fetch(CDP_URL + '/json')
      .then((r) => { if (!r.ok) throw new Error('chrome_cdp_http_' + r.status); return r.json(); })
      .then((tabs) => {
        const pages = Array.isArray(tabs) ? tabs.filter((x) => x && x.type === 'page' && x.webSocketDebuggerUrl) : [];
        const candidates = pageUrl ? pages.filter((x) => String(x.url || '').startsWith(String(pageUrl))) : pages;
        if (candidates.length === 0) throw new Error('chrome_cdp_page_unavailable');
        if (candidates.length > 1) throw new Error('chrome_cdp_page_ambiguous');
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
  try {
    const result = await cdpCall('Runtime.evaluate',{returnByValue:true,awaitPromise:true,expression:actionExpression},timeout_ms,pageUrl);
    const value = result && result.result && result.result.value;
    if (!value || value.ok !== true) return {status:'failed',action,error:value && value.error || 'chrome_cdp_semantic_action_failed',version:'aria-windows-chrome-semantic-v1'};
    return {status:'succeeded',action,method:'chrome-cdp-semantic',version:'aria-windows-chrome-semantic-v1',matched:value.matched,ui:value.ui};
  } catch (error) {
    return {status:'failed',action,error:String(error && error.message || error),version:'aria-windows-chrome-semantic-v1'};
  }
}

module.exports = Object.freeze({executeChromeSemanticAction});
