const fs = require('node:fs');
const text = fs.readFileSync('.github/workflows/aria-cloudflare-deploy.yml','utf8');
if (!text.includes('GROK_CONSENT_OPTIONAL_STATUS=$status')) throw new Error('missing optional Grok status');
if (!text.includes('GROK_CONSENT_EXTERNAL_BLOCKED')) throw new Error('missing external blocked classification');
if (!text.includes('external blockage does not block the ARIA core deployment')) throw new Error('missing non-blocking policy');
if (!text.includes('--max-time 12')) throw new Error('Grok request is not bounded');

const worker = fs.readFileSync('worker.js', 'utf8');
const oauthSource = fs.readFileSync('supabase/functions/aria-mcp-inbound-grok-v1/index.ts', 'utf8');
const start = worker.indexOf('const requestedScopes=String(url.searchParams.get("scope")');
const end = worker.indexOf('const client=(html.match(/<strong>', start);
if (start < 0 || end < 0) throw new Error('missing scope-aware OAuth authorization UI');
const elevatedBranch = worker.slice(start, end);
if (!elevatedBranch.includes('requestedScopes.includes("aria.project.cuevacoin.control")')) throw new Error('CuevaCoin control scope must have its own consent rendering path');
if (!elevatedBranch.includes('return new Response(html,{status:upstream.status')) throw new Error('elevated scope must preserve upstream consent HTML');
if (!elevatedBranch.includes('elevated-form-v1')) throw new Error('missing elevated consent UI marker');
const elevatedCsp = (elevatedBranch.match(/elevatedHeaders\\.set\\("content-security-policy","([^"]+)"\\)/) || [])[1] || "";
if (!elevatedCsp) throw new Error('elevated consent response must replace the gateway sandbox CSP');
for (const directive of ["style-src 'unsafe-inline'", "style-src-attr 'unsafe-inline'", "form-action 'self'", "base-uri 'none'", "frame-ancestors 'none'", "script-src 'none'"]) {
  if (!elevatedCsp.includes(directive)) throw new Error('elevated consent CSP missing required directive: ' + directive);
}
if (/(^|;)\\s*sandbox(?:\\s|;|$)/.test(elevatedCsp)) throw new Error('elevated consent CSP must not sandbox form submission');
if (!worker.includes('x-aria-grok-consent":"direct-link-v2')) throw new Error('legacy read-only Grok UI compatibility was removed');
if (!oauthSource.includes('control_confirmation')) throw new Error('upstream consent form must include explicit control confirmation');
if (!oauthSource.includes('AUTHORIZE CUEVACOIN CONTROL')) throw new Error('upstream consent form must show the exact phrase');
if (!/form\.get\("control_confirmation"\)\|\|""\)\s*!==\s*"AUTHORIZE CUEVACOIN CONTROL"/.test(oauthSource)) throw new Error('backend must reject elevated consent without the exact phrase');

console.log('grok-optional-certification-contract.test.js: PASS');
