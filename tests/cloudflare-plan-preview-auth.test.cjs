'use strict';

const assert = require('node:assert/strict');
const {
  deriveCloudflarePlanPreviewToken,
  isCloudflarePlanPreviewExecutionAllowed
} = require('../supabase/functions/_shared/cloudflare-plan-preview-auth-v1.mjs');

(async () => {
  const secret = 'cloudflare-plan-preview-test-secret'.padEnd(48, 's');
  const token = await deriveCloudflarePlanPreviewToken(secret);
  const request = new Request('https://aria.test/functions/v1/aria-execution-runtime-v1', {
    method: 'POST',
    headers: { 'x-aria-plan-preview-token': token },
    body: '{}'
  });
  const body = {
    execution_version: '1',
    request_id: 'aria-cloudflare-plan-preview-v1:test-1',
    task_id: 'cloudflare_workspace_plan_preview',
    selected_route: {
      provider_id: 'openrouter',
      account_id: 'acct_openrouter_primary',
      model_id: 'nvidia/nemotron-3.5-lightning:free',
      capability: 'text_generation'
    },
    authorization: {
      status: 'approved',
      risk_class: 'READ',
      evidence_ref: 'aria-cloudflare-plan-preview-v1'
    },
    input: { payload: { prompt: 'Produce a read-only status plan. Return JSON only.', max_tokens: 700, temperature: 0 } },
    policy: { aria_cloudflare_plan_preview: true, read_only: true, tool_use: false },
    metadata: { purpose: 'aria-cloudflare-plan-preview-v1' }
  };
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret, body), true);
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret + 'wrong', body), false);

  const wrongModel = structuredClone(body);
  wrongModel.selected_route.model_id = 'google/gemini-3.5-flash-direct';
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret, wrongModel), false);

  const tooManyTokens = structuredClone(body);
  tooManyTokens.input.payload.max_tokens = 701;
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret, tooManyTokens), false);

  const toolsRequest = structuredClone(body);
  toolsRequest.input.payload.tools = [{ type: 'mcp', server_url: 'https://untrusted.invalid' }];
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret, toolsRequest), false);

  const missionMutation = structuredClone(body);
  missionMutation.metadata.mission_id = 'mission_must_not_exist';
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret, missionMutation), false);

  const writePolicy = structuredClone(body);
  writePolicy.policy.read_only = false;
  assert.equal(await isCloudflarePlanPreviewExecutionAllowed(request, secret, writePolicy), false);

  process.stdout.write('CLOUDFLARE_PLAN_PREVIEW_SCOPED_AUTH=PASS\n');
  process.stdout.write('CLOUDFLARE_PLAN_PREVIEW_READ_ONLY_ALLOWLIST=PASS\n');
})().catch(error => {
  process.stderr.write((error && error.stack) || String(error));
  process.exitCode = 1;
});
