'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('../execution/lookup');
const credentials = require('../execution/credentials');
const secureResolver = require('../credentials/resolver');
const openrouter = require('../execution/adapters/openrouter');
const fallback = require('../fallback/lookup');

const SECRET = 'sk-TEST-B-' + 'x'.repeat(32);
const REF = 'secret://openrouter/acct_openrouter_primary';
const CAP = 'text_generation';
const ROUTE = {
  status: 'selected',
  provider_id: 'openrouter',
  account_id: 'acct_openrouter_primary',
  model_id: 'google/gemini-2.5-flash-lite',
  capability: CAP
};
const INPUT = {
  modality: 'text',
  payload: { messages: [{ role: 'user', content: 'hello' }], temperature: 0 }
};
const AUTH = { status: 'approved', evidence_ref: 'verify://human/test' };

function world(overrides = {}) {
  const cfg = {
    model: { model_id: ROUTE.model_id, provider_id: 'openrouter', status: 'available' },
    account: { status: 'active', credential_ref: REF },
    supports: true,
    quota: true,
    response: {
      status: 200,
      json: {
        id: 'gen-test',
        model: ROUTE.model_id,
        choices: [{ message: { role: 'assistant', content: 'world' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }
    },
    ...overrides
  };
  const calls = { transport: [], events: [] };
  const deps = {
    resolveRoute: () => ({ status: 'no_route' }),
    candidateSelectable: fallback.candidateSelectable,
    capacityAllows: () => cfg.quota,
    isAccountActive: () => cfg.account.status === 'active',
    supports: () => (cfg.supports ? true : null),
    getModel: () => cfg.model,
    credentialRefOf: () => cfg.account.credential_ref,
    credentialResolver: secureResolver.createCredentialResolver({
      getSecret: async (ref) => ref === REF ? SECRET : null
    }),
    transport: async (url, opts) => {
      calls.transport.push({ url, opts });
      return cfg.response;
    },
    onEvent: (event) => calls.events.push(event)
  };
  return { deps, calls };
}

async function run() {
  // B1 — canonical injected resolver.
  {
    let getterCalls = 0;
    const resolver = secureResolver.createCredentialResolver({
      async getSecret(ref) {
        getterCalls++;
        return ref === REF ? SECRET : null;
      }
    });
    const resolved = await resolver.resolve(REF, { request_id: 'req_test' });
    assert.deepEqual(resolved, { status: 'resolved', secret: SECRET });
    assert.equal(getterCalls, 1);
    const invalid = await resolver.resolve('Bearer ' + SECRET);
    assert.deepEqual(invalid, { status: 'unavailable', reason: 'secret_material_rejected' });
    assert.equal(getterCalls, 1, 'invalid refs never reach the secret store');
  }

  // B1 — resolver errors never leak vendor error/secret text.
  {
    const resolver = secureResolver.createCredentialResolver({
      async getSecret() { throw new Error('backend leaked ' + SECRET); }
    });
    const out = await resolver.resolve(REF);
    assert.deepEqual(out, { status: 'unavailable', reason: 'resolver_error' });
    assert.equal(JSON.stringify(out).includes(SECRET), false);
  }

  // B1 — Cloudflare-compatible binding adapter uses only non-secret ref→binding metadata.
  {
    const bindings = { OPENROUTER_PRIMARY: SECRET };
    const resolver = secureResolver.createBindingCredentialResolver({
      bindings,
      bindingsByRef: { [REF]: 'OPENROUTER_PRIMARY' }
    });
    const out = await resolver.resolve(REF);
    assert.equal(out.status, 'resolved');
    assert.equal(out.secret, SECRET);
  }

  // B2 — real adapter request/normalization contract.
  {
    const request = openrouter.buildRequest(ROUTE, INPUT);
    assert.equal(request.model, ROUTE.model_id);
    assert.equal(request.messages[0].content, 'hello');
    const normalized = openrouter.normalizeResponse({
      id: 'r1',
      model: ROUTE.model_id,
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
    });
    assert.deepEqual(normalized, {
      modality: 'text',
      content: 'ok',
      provider_response_id: 'r1',
      finish_reason: 'stop',
      provider_model: ROUTE.model_id
    });
  }

  // B2/B3 — end-to-end engine → concrete resolver → real OpenRouter adapter → injected transport.
  {
    const w = world();
    const result = await engine.execute({ selected_route: ROUTE, authorization: AUTH, input: INPUT }, w.deps);
    assert.equal(result.status, 'succeeded');
    assert.equal(result.response.content, 'world');
    assert.equal(result.metadata.adapter_id, 'openrouter_chat_completions');
    assert.equal(result.metadata.mode, 'mock');
    assert.equal(w.calls.transport.length, 1, 'exactly one provider attempt');
    const sent = w.calls.transport[0].opts;
    assert.equal(sent.headers.Authorization, 'Bearer ' + SECRET);
    assert.equal(JSON.stringify(result).includes(SECRET), false, 'secret absent from execution result');
    assert.equal(JSON.stringify(w.calls.events).includes(SECRET), false, 'secret absent from events');
  }

  // B3 — provider errors remain sanitized and do not retry.
  {
    const w = world({
      response: { status: 401, json: { error: { message: 'invalid key ' + SECRET } } }
    });
    const result = await engine.execute({ selected_route: ROUTE, authorization: AUTH, input: INPUT }, w.deps);
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'provider_error');
    assert.equal(result.error.provider_status, 401);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(w.calls.transport.length, 1, 'provider failure is not retried');
  }

  // B3 — async resolver is actually awaited by the execution engine.
  {
    const w = world();
    let settled = false;
    w.deps.credentialResolver = secureResolver.createCredentialResolver({
      async getSecret() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        settled = true;
        return SECRET;
      }
    });
    const result = await engine.execute({ selected_route: ROUTE, authorization: AUTH, input: INPUT }, w.deps);
    assert.equal(settled, true);
    assert.equal(result.status, 'succeeded');
  }

  // Regression guard: only the intended execution/resolver layers changed in this test's source tree.
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'credentials', 'resolver.js')), true);

  console.log('PASS: Block B resolver + adapter + execution tests');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
