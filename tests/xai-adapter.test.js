'use strict';

/**
 * xAI / Grok Provider Adapter unit tests (MOCK only — no real provider calls)
 * Run: node tests/xai-adapter.test.js
 */
const assert = require('assert');
const {
  descriptor,
  buildRequest,
  buildInput,
  sanitizeMcpTools,
  normalizeResponse,
  normalizeUsage,
  upstreamModel,
  execute,
  ENDPOINT
} = require('../execution/adapters/xai.js');

const FAKE_SECRET = 'xai-test-secret-' + 'x'.repeat(16);
const MCP_AUTH = 'Bearer mcp-token-test-only-never-log';
const ROUTE = {
  provider_id: 'xai',
  account_id: 'acct_xai_primary',
  model_id: 'xai/grok-4.6',
  capability: 'text_generation'
};

let passed = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  passed++;
  console.log('PASS:', msg);
}
function eq(a, b, msg) {
  assert.strictEqual(a, b, msg + ` (got ${JSON.stringify(a)})`);
  passed++;
  console.log('PASS:', msg);
}

// Test A — request construction
{
  eq(descriptor.provider_id, 'xai', 'A1: provider_id is xai');
  eq(descriptor.adapter_id, 'xai_responses', 'A2: adapter_id is xai_responses');
  ok(descriptor.operations.includes('text_generation'), 'A3: supports text_generation');
  eq(ENDPOINT, 'https://api.x.ai/v1/responses', 'A4: Responses API endpoint');
  eq(upstreamModel(ROUTE), 'grok-4.6', 'A5: upstream model strips xai/ prefix');

  const body = buildRequest(ROUTE, {
    payload: { messages: [{ role: 'user', content: 'hello' }], temperature: 0.3, max_tokens: 64 }
  });
  eq(body.model, 'grok-4.6', 'A6: model in request');
  ok(Array.isArray(body.input), 'A7: input is array');
  eq(body.input[0].content, 'hello', 'A8: message content');
  eq(body.temperature, 0.3, 'A9: temperature forwarded');
  eq(body.max_output_tokens, 64, 'A10: max_tokens → max_output_tokens');

  const fromPrompt = buildRequest(ROUTE, { payload: { prompt: 'ping' } });
  eq(fromPrompt.input[0].role, 'user', 'A11: prompt becomes user message');

  ok(buildRequest(ROUTE, { payload: {} }) === null, 'A12: empty payload → null');
}

// Test B — Bearer API key
(async () => {
  let observed;
  const result = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'hi' } },
    secret: FAKE_SECRET,
    transport: async (url, options) => {
      observed = { url, options };
      return {
        status: 200,
        json: {
          id: 'resp_1',
          model: 'grok-4.6',
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello from grok' }] }],
          usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 }
        }
      };
    }
  });
  eq(observed.url, ENDPOINT, 'B1: targets Responses API');
  eq(observed.options.headers.Authorization, 'Bearer ' + FAKE_SECRET, 'B2: Bearer secret in Authorization');
  eq(observed.options.headers['Content-Type'], 'application/json', 'B3: JSON content-type');
  ok(result.ok, 'B4: execute ok');

  // Test C — normalized response
  eq(result.response.content, 'hello from grok', 'C1: text content normalized');
  eq(result.response.modality, 'text', 'C2: modality text');
  eq(result.response.provider_response_id, 'resp_1', 'C3: provider_response_id');
  eq(result.response.provider_model, 'grok-4.6', 'C4: provider_model');

  // Test D — usage
  eq(result.usage.status, 'reported', 'D1: usage reported');
  eq(result.usage.prompt_tokens, 2, 'D2: input_tokens → prompt_tokens');
  eq(result.usage.completion_tokens, 3, 'D3: output_tokens → completion_tokens');
  eq(result.usage.total_tokens, 5, 'D4: total_tokens');

  // Test E — errors
  const r401 = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'x' } },
    secret: FAKE_SECRET,
    transport: async () => ({ status: 401, json: { error: { message: 'unauthorized' } } })
  });
  eq(r401.ok, false, 'E1: 401 not ok');
  eq(r401.error.code, 'provider_error', 'E2: provider_error');
  eq(r401.error.provider_status, 401, 'E3: status 401');

  const r429 = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'x' } },
    secret: FAKE_SECRET,
    transport: async () => ({ status: 429, json: { error: { message: 'rate limited' } } })
  });
  eq(r429.error.provider_status, 429, 'E4: 429 preserved');

  const r5xx = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'x' } },
    secret: FAKE_SECRET,
    transport: async () => ({ status: 503, json: {} })
  });
  eq(r5xx.error.provider_status, 503, 'E5: 5xx preserved');

  const to = new Error('t');
  to.name = 'TimeoutError';
  const rTimeout = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'x' } },
    secret: FAKE_SECRET,
    transport: async () => { throw to; }
  });
  eq(rTimeout.error.code, 'timeout', 'E6: timeout mapped');

  const rInvalid = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'x' } },
    secret: FAKE_SECRET,
    transport: async () => ({ status: 200, json: { output: [] } })
  });
  eq(rInvalid.error.code, 'invalid_response', 'E7: empty output → invalid_response');

  // Test F — MCP tool inclusion
  const mcpBody = buildRequest(ROUTE, {
    payload: {
      prompt: 'use aria',
      tools: [
        {
          type: 'mcp',
          server_url: 'https://aria.robvg9.workers.dev/mcp',
          server_label: 'aria',
          authorization: MCP_AUTH
        }
      ]
    }
  });
  ok(Array.isArray(mcpBody.tools), 'F1: tools array present');
  eq(mcpBody.tools[0].type, 'mcp', 'F2: type mcp');
  eq(mcpBody.tools[0].server_url, 'https://aria.robvg9.workers.dev/mcp', 'F3: server_url');
  eq(mcpBody.tools[0].server_label, 'aria', 'F4: server_label');
  eq(mcpBody.tools[0].authorization, MCP_AUTH, 'F5: authorization passed through');

  const sanitized = sanitizeMcpTools([
    { type: 'mcp', server_url: 'https://example.com/mcp', server_label: 'ex' },
    { type: 'function', name: 'ignore' },
    { type: 'mcp' }
  ]);
  eq(sanitized.length, 1, 'F6: non-mcp and incomplete entries dropped');

  // Test G — authorization MCP not in results / no secret leak
  let mcpObserved;
  const mcpResult = await execute({
    route: ROUTE,
    input: {
      payload: {
        prompt: 'call aria_context',
        tools: [
          {
            type: 'mcp',
            server_url: 'https://aria.robvg9.workers.dev/mcp',
            server_label: 'aria',
            authorization: MCP_AUTH
          }
        ]
      }
    },
    secret: FAKE_SECRET,
    transport: async (url, options) => {
      mcpObserved = { url, body: JSON.parse(options.body) };
      return {
        status: 200,
        json: {
          id: 'resp_mcp',
          output: [{ type: 'message', content: [{ type: 'output_text', text: 'context ok' }] }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
        }
      };
    }
  });
  ok(mcpResult.ok, 'G1: MCP request succeeds');
  eq(mcpObserved.body.tools[0].authorization, MCP_AUTH, 'G2: auth present in outbound request');
  const dump = JSON.stringify(mcpResult);
  ok(dump.indexOf(FAKE_SECRET) === -1, 'G3: XAI secret never in result');
  ok(dump.indexOf(MCP_AUTH) === -1, 'G4: MCP authorization never in result');
  ok(dump.indexOf('mcp-token') === -1, 'G5: MCP token fragment not in result');

  // Test H — credential path (secret required; missing → credential_unavailable)
  const noSecret = await execute({
    route: ROUTE,
    input: { payload: { prompt: 'x' } },
    secret: '',
    transport: async () => ({ status: 200, json: {} })
  });
  eq(noSecret.error.code, 'credential_unavailable', 'H1: missing secret → credential_unavailable');

  // Test I — contract compatibility / wrong provider blocked
  const wrong = await execute({
    route: { ...ROUTE, provider_id: 'openrouter' },
    input: { payload: { prompt: 'x' } },
    secret: FAKE_SECRET,
    transport: async () => ({ status: 200, json: {} })
  });
  eq(wrong.error.code, 'adapter_error', 'I1: provider mismatch → adapter_error');

  ok(typeof buildInput === 'function', 'I2: buildInput exported');
  ok(typeof normalizeUsage === 'function', 'I3: normalizeUsage exported');

  console.log('\nxai-adapter.test.js: ' + passed + ' assertions passed');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
