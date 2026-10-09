'use strict';
const assert = require('node:assert/strict');
const { createCuevacoinOAuthE2E } = require('../integrations/cuevacoin-oauth-e2e');

async function run(path, method = 'GET') {
  const handler = createCuevacoinOAuthE2E();
  const url = new URL('https://aria.robvg9.workers.dev' + path);
  return handler(new Request(url, { method }), url);
}
(async () => {
  const start = await run('/oauth/cuevacoin-control-e2e');
  assert.equal(start.status, 200);
  assert.match(start.headers.get('content-type'), /text\/html/);
  assert.match(start.headers.get('cache-control'), /no-store/);
  assert.equal(start.headers.get('referrer-policy'), 'no-referrer');
  const html = await start.text();
  assert.match(html, /Iniciar autorización correcta/);
  assert.match(html, /aria\.project\.cuevacoin\.control/);
  assert.match(html, /code_challenge_method/);
  assert.match(html, /sessionStorage/);
  const csp = start.headers.get('content-security-policy');
  const nonce = csp.match(/script-src 'nonce-([a-f0-9]+)'/)[1];
  assert.ok(html.includes('<script nonce="' + nonce + '">'));

  const callback = await run('/oauth/cuevacoin-control-e2e/callback?code=probe&state=probe');
  assert.equal(callback.status, 200);
  const callbackHtml = await callback.text();
  assert.match(callbackHtml, /oauth_state_mismatch/);
  assert.match(callbackHtml, /oauth_issuer_mismatch/);
  assert.match(callbackHtml, /cuevacoin_connection_status/);
  assert.match(callbackHtml, /cuevacoin_project_control/);
  assert.match(callbackHtml, /history\.replaceState/);
  assert.match(callback.headers.get('content-security-policy'), /script-src 'nonce-/);

  const head = await run('/oauth/cuevacoin-control-e2e', 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const rejected = await run('/oauth/cuevacoin-control-e2e', 'POST');
  assert.equal(rejected.status, 405);
  const missing = await run('/oauth/cuevacoin-control-e2e/unknown');
  assert.equal(missing.status, 404);
  console.log('aria-cuevacoin-oauth-callback: PASS');
})().catch(error => {
  console.error('aria-cuevacoin-oauth-callback: FAIL');
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
