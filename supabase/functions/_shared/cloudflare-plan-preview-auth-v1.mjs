'use strict';

const TOKEN_HEADER = 'x-aria-plan-preview-token';
const DERIVATION_LABEL = 'aria-cloudflare-readonly-plan-preview:v1';
const encoder = new TextEncoder();

export async function deriveCloudflarePlanPreviewToken(secret) {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('aria_runtime_shared_secret_invalid');
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

export const CLOUDFLARE_PLAN_PREVIEW_TOKEN_HEADER = TOKEN_HEADER;
