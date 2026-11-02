'use strict';

const TOKEN_HEADER = 'x-aria-plan-preview-token';
const DERIVATION_LABEL = 'aria-cloudflare-readonly-plan-preview:v1';
const encoder = new TextEncoder();

export async function deriveCloudflarePlanPreviewToken(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('aria_plan_producer_secret_invalid');
  }
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(DERIVATION_LABEL)
  );
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function isCloudflarePlanPreviewRequest(request, secret) {
  if (!(request instanceof Request) || request.method !== 'POST') return false;
  const supplied = request.headers.get(TOKEN_HEADER) || '';
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  let expected;
  try {
    expected = await deriveCloudflarePlanPreviewToken(secret);
  } catch (_) {
    return false;
  }
  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}


export async function isCloudflarePlanPreviewExecutionAllowed(request, secret, body) {
  if (!(await isCloudflarePlanPreviewRequest(request, secret))) return false;
  const route = body && body.selected_route;
  const payload = body && body.input && body.input.payload;
  const policy = body && body.policy;
  const authorization = body && body.authorization;
  const metadata = body && body.metadata;
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
  const requestId = String(body?.request_id || '');
  return body?.execution_version === '1' &&
    requestId.startsWith('aria-cloudflare-plan-preview-v1:') &&
    body?.task_id === 'cloudflare_workspace_plan_preview' &&
    metadata?.purpose === 'aria-cloudflare-plan-preview-v1' &&
    policy?.aria_cloudflare_plan_preview === true &&
    policy?.read_only === true &&
    policy?.tool_use === false &&
    authorization?.status === 'approved' &&
    authorization?.risk_class === 'READ' &&
    authorization?.evidence_ref === 'aria-cloudflare-plan-preview-v1' &&
    route?.provider_id === 'openrouter' &&
    route?.account_id === 'acct_openrouter_primary' &&
    route?.model_id === 'nvidia/nemotron-3.5-lightning:free' &&
    route?.capability === 'text_generation' &&
    prompt.length >= 20 &&
    prompt.length <= 16000 &&
    Number(payload?.max_tokens || 0) > 0 &&
    Number(payload?.max_tokens || 0) <= 700 &&
    Number(payload?.temperature) === 0 &&
    !Array.isArray(payload?.tools) &&
    !metadata?.mission_id &&
    !metadata?.step_id;
}

export const CLOUDFLARE_PLAN_PREVIEW_TOKEN_HEADER = TOKEN_HEADER;
