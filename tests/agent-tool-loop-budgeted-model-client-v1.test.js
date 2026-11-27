'use strict';

const assert = require('node:assert/strict');

(async () => {
  const {
    buildGeminiContents,
    classifyAgentToolModelFailure,
    createBudgetedModelCaller,
  } = await import('../supabase/functions/aria-agent-runtime-v1/budgeted-model-client-v1.mjs');

  const requests = [];
  const responses = [];
  let nonce = 0;
  const caller = createBudgetedModelCaller({
    endpoint: 'https://mock.invalid/functions/v1/aria-execution-runtime-v1',
    secret: 'mock-runtime-secret',
    nonceFactory: () => 'nonce-' + (++nonce),
    signalFactory: () => undefined,
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://mock.invalid/functions/v1/aria-execution-runtime-v1');
      requests.push({ url, init, body: JSON.parse(init.body) });
      const next = responses.shift();
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        json: async () => next.body,
      };
    },
  });

  const agent = { agent_id: 'agent-coding-test', role: 'coding' };
  const missionId = 'mission-mock-budget';
  const stepId = 'step-tool-loop';
  const gatePolicy = { human_gate_required: true };
  const gateAuthorization = {
    human_gate_verified: true,
    human_gate_mission_id: missionId,
    human_gate_step_id: stepId,
    human_gate_action_hash: 'sha256:mock-action',
    human_gate_approval_token: 'mock-approval-token',
  };
  const tool = {
    type: 'function',
    function: {
      name: 'github_file_read',
      description: 'Read one repository file',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  };

  // Gemini turn 1: tool call must travel through the budgeted runtime.
  const geminiParts = [{
    functionCall: { id: 'gemini-call-1', name: 'github_file_read', args: { path: 'README.md' } },
    thoughtSignature: 'opaque-provider-signature',
  }];
  responses.push({
    status: 200,
    body: {
      status: 'succeeded',
      response: {
        content: '',
        tool_calls: [{
          id: 'gemini-call-1',
          type: 'function',
          function: { name: 'github_file_read', arguments: '{"path":"README.md"}' },
        }],
        gemini_parts: geminiParts,
        gemini_meta: { finish_reason: 'STOP' },
      },
    },
  });

  const first = await caller(
    agent, missionId, stepId, 'gemini-3.1-flash-lite',
    [{ role: 'system', content: 'Inspect with evidence.' }, { role: 'user', content: 'Read README.' }],
    [tool], true, 'google', true, gatePolicy, gateAuthorization,
  );
  assert.equal(first.tool_calls[0].id, 'gemini-call-1');
  assert.deepEqual(first.geminiParts, geminiParts);

  const firstRequest = requests[0].body;
  assert.equal(requests[0].init.headers.authorization, 'Bearer mock-runtime-secret');
  assert.equal(firstRequest.request_id, missionId + ':' + stepId + ':nonce-1');
  assert.equal(firstRequest.task_id, stepId);
  assert.equal(firstRequest.metadata.mission_id, missionId);
  assert.equal(firstRequest.metadata.step_id, stepId);
  assert.equal(firstRequest.policy.mission_budget_required, true);
  assert.equal(firstRequest.policy.human_gate_required, true);
  assert.equal(firstRequest.authorization.human_gate_verified, true);
  assert.equal(firstRequest.authorization.risk_class, 'LOW_RISK_WRITE');
  assert.equal(firstRequest.selected_route.model_id, 'google/gemini-3.1-flash-lite-direct');
  assert.equal(firstRequest.input.payload.tool_choice, 'required');
  assert.equal(firstRequest.input.payload.tools[0].functionDeclarations[0].name, 'github_file_read');

  // Gemini turn 2: preserve the provider's exact thought-bearing parts and bind the tool response.
  responses.push({
    status: 200,
    body: { status: 'succeeded', response: { content: 'FINDINGS: read complete\nVERDICT: evidence captured' } },
  });
  const second = await caller(
    agent, missionId, stepId, 'gemini-3.1-flash-lite',
    [
      { role: 'system', content: 'Inspect with evidence.' },
      { role: 'user', content: 'Read README.' },
      first,
      { role: 'tool', tool_call_id: 'gemini-call-1', name: 'github_file_read', content: '{"ok":true,"path":"README.md"}' },
    ],
    [], false, 'google', true, gatePolicy, gateAuthorization,
  );
  assert.match(second.content, /^FINDINGS:/);
  const secondPayload = requests[1].body.input.payload;
  assert.deepEqual(secondPayload.contents[1].parts, geminiParts);
  const toolReply = secondPayload.contents[2].parts[0].functionResponse;
  assert.equal(toolReply.name, 'github_file_read');
  assert.equal(toolReply.id, 'gemini-call-1');
  assert.deepEqual(toolReply.response, { ok: true, path: 'README.md' });
  assert.equal(secondPayload.contents[2].role, 'user');
  assert.equal(requests[1].body.request_id, missionId + ':' + stepId + ':nonce-2');
  assert.notEqual(requests[0].body.request_id, requests[1].body.request_id);
  assert.equal(requests[1].body.policy.mission_budget_required, true);
  assert.equal(requests[1].body.policy.tool_use, false);

  // OpenRouter uses the same execution endpoint and preserves the OpenAI tool-call envelope.
  responses.push({
    status: 200,
    body: { status: 'succeeded', response: { content: 'FINDINGS: inspected\nVERDICT: confirmed' } },
  });
  await caller(
    agent, missionId, stepId, 'openrouter/qwen/qwen3-coder:free',
    [
      { role: 'assistant', content: '', tool_calls: [{ id: 'or-call-1', type: 'function', function: { name: 'github_file_read', arguments: '{"path":"README.md"}' } }] },
      { role: 'tool', tool_call_id: 'or-call-1', name: 'github_file_read', content: '{"ok":true}' },
    ],
    [tool], false, 'openrouter', false, {}, {},
  );
  const openRouterRequest = requests[2].body;
  assert.equal(openRouterRequest.selected_route.model_id, 'openrouter/qwen/qwen3-coder:free');
  assert.equal(openRouterRequest.input.payload.tool_choice, 'auto');
  assert.equal(openRouterRequest.input.payload.messages[0].tool_calls[0].id, 'or-call-1');
  assert.equal(openRouterRequest.input.payload.messages[1].name, 'github_file_read');
  assert.equal(openRouterRequest.policy.mission_budget_required, true);
  assert.equal(openRouterRequest.authorization.risk_class, 'READ');

  // Missing mission identity and missing Human Gate must fail before fetch.
  const requestCountBeforeGuards = requests.length;
  await assert.rejects(
    caller(agent, '', stepId, 'gemini-3.1-flash-lite', [], [], false, 'google', false, {}, {}),
    /agent_tool_loop_mission_identity_required/,
  );
  await assert.rejects(
    caller(agent, missionId, stepId, 'gemini-3.1-flash-lite', [], [tool], true, 'google', true, {}, {}),
    /agent_tool_loop_human_gate_required/,
  );
  await assert.rejects(
    caller(agent, 'another-mission', stepId, 'gemini-3.1-flash-lite', [], [tool], true, 'google', true, gatePolicy, gateAuthorization),
    /agent_tool_loop_human_gate_scope_mismatch/,
  );
  await assert.rejects(
    caller(agent, missionId, 'another-step', 'gemini-3.1-flash-lite', [], [tool], true, 'google', true, gatePolicy, gateAuthorization),
    /agent_tool_loop_human_gate_scope_mismatch/,
  );
  assert.equal(requests.length, requestCountBeforeGuards);

  // A budget denial or uncertain settlement remains a typed terminal error.
  responses.push({
    status: 423,
    body: { status: 'blocked', reason: 'mission_budget_policy_missing', error: { code: 'mission_budget_policy_missing' } },
  });
  await assert.rejects(
    caller(agent, missionId, stepId, 'gemini-3.1-flash-lite', [], [], false, 'google', false, {}, {}),
    (error) => error.code === 'mission_budget_policy_missing' && error.providerStatus === 423,
  );

  responses.push({
    status: 503,
    body: { status: 'blocked', reason: 'mission_budget_settlement_pending', error: { code: 'mission_budget_settlement_pending' } },
  });
  await assert.rejects(
    caller(agent, missionId, stepId, 'gemini-3.1-flash-lite', [], [], false, 'google', false, {}, {}),
    (error) => error.code === 'mission_budget_settlement_pending',
  );

  const budgetDenied = new Error('mission_budget_policy_missing: quota 429');
  budgetDenied.code = 'mission_budget_policy_missing';
  assert.equal(classifyAgentToolModelFailure(budgetDenied, 0, false).canFallback, false);
  const uncertain = new Error('mission_budget_settlement_pending: transport state uncertain');
  uncertain.code = 'mission_budget_settlement_pending';
  assert.equal(classifyAgentToolModelFailure(uncertain, 0, false).canFallback, false);
  assert.equal(classifyAgentToolModelFailure(new Error('HTTP 429 quota exceeded'), 0, false).canFallback, true);
  assert.equal(classifyAgentToolModelFailure(new Error('503 service unavailable'), 0, false).canFallback, true);
  assert.equal(classifyAgentToolModelFailure(new Error('401 invalid credential'), 0, false).canFallback, true);
  assert.equal(classifyAgentToolModelFailure(new Error('HTTP 429 quota exceeded'), 1, false).canFallback, false);
  assert.equal(classifyAgentToolModelFailure(new Error('HTTP 429 quota exceeded'), 0, true).canFallback, false);

  const converted = buildGeminiContents([
    { role: 'system', content: 'one' },
    { role: 'system', content: 'two' },
    { role: 'user', content: 'hello' },
  ]);
  assert.equal(converted.systemInstruction.parts[0].text, 'one\n\ntwo');
  assert.equal(converted.contents[0].role, 'user');

  console.log('ARIA BUDGETED MODEL CLIENT MOCK E2E: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
