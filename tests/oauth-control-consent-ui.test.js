const assert = require('node:assert/strict');
const fs = require('node:fs');

const worker = fs.readFileSync('worker.js', 'utf8');
const oauthSource = fs.readFileSync('supabase/functions/aria-mcp-inbound-grok-v1/index.ts', 'utf8');

const start = worker.indexOf('const requestedScopes=String(url.searchParams.get("scope")');
const end = worker.indexOf('const client=(html.match(/<strong>', start);
assert.notEqual(start, -1, 'Worker must inspect the requested OAuth scopes before selecting the consent UI');
assert.notEqual(end, -1, 'Worker must retain the legacy read-only consent UI after the elevated-scope branch');
const elevatedBranch = worker.slice(start, end);
assert.match(elevatedBranch, /requestedScopes\.includes\("aria\.project\.cuevacoin\.control"\)/,
  'CuevaCoin control scope must have a separate consent rendering path');
assert.match(elevatedBranch, /return new Response\(html,\{status:upstream\.status/,
  'Elevated scope must preserve the upstream consent page instead of replacing it with direct-link HTML');
assert.match(elevatedBranch, /elevated-form-v1/,
  'Elevated authorization UI must be tagged for live verification');
assert.match(worker, /x-aria-grok-consent":"direct-link-v2/,
  'The legacy read-only direct-link compatibility header must remain available');
assert.match(worker, /class="btn" href="\$\{allow\}"/,
  'Read-only direct-link allow action must remain available');
assert.match(worker, /class="btn secondary" href="\$\{deny\}"/,
  'Read-only direct-link deny action must remain available');

assert.match(oauthSource, /name="control_confirmation"/,
  'Upstream consent form must include the explicit elevated-scope confirmation input');
assert.match(oauthSource, /AUTHORIZE CUEVACOIN CONTROL/,
  'Upstream consent form must show the exact confirmation phrase');
assert.match(oauthSource, /form\.get\("control_confirmation"\)\|\|""\)\s*!==\s*"AUTHORIZE CUEVACOIN CONTROL"/,
  'Backend must reject elevated authorization unless the exact phrase is submitted');

console.log('oauth-control-consent-ui.test.js: PASS');
