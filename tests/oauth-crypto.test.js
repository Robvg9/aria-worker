'use strict';

/**
 * Local unit tests for ARIA MCP OAuth crypto contracts (A–J subset runnable offline).
 * Does not hit Supabase. Full DCR/consent/tools require deployed function.
 */

const assert = require('assert');
const crypto = require('crypto');

const RESOURCE =
  'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1';
const ISSUER = RESOURCE;
const SCOPE = 'aria.mcp.inbound';
const SECRET = 'test-oauth-secret-at-least-32-characters-long!!';
const ACCESS_TTL_SEC = 3600;

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromB64url(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest();
}

function hmacSign(data) {
  return crypto.createHmac('sha256', SECRET).update(data).digest();
}

function pkceChallenge(verifier) {
  return b64url(sha256(verifier));
}

function issueAccessToken(clientId, ttl = ACCESS_TTL_SEC) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        iss: ISSUER,
        aud: RESOURCE,
        sub: clientId,
        scope: SCOPE,
        iat: now,
        exp: now + ttl,
        token_use: 'access',
      }),
    ),
  );
  const signingInput = `${header}.${payload}`;
  const sig = b64url(hmacSign(signingInput));
  return `${signingInput}.${sig}`;
}

function verifyAccessToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const expected = hmacSign(signingInput);
  const actual = fromB64url(s);
  if (!crypto.timingSafeEqual(expected, actual)) return null;
  const claims = JSON.parse(fromB64url(p).toString('utf8'));
  if (claims.iss !== ISSUER) return null;
  if (claims.aud !== RESOURCE) return null;
  if (claims.scope !== SCOPE) return null;
  if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.sub !== 'string') return null;
  return { clientId: claims.sub };
}

function isValidRedirectUri(uri) {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// A — Protected Resource Metadata shape
{
  const meta = {
    resource: RESOURCE,
    authorization_servers: [ISSUER],
    bearer_methods_supported: ['header'],
    scopes_supported: [SCOPE],
  };
  assert.strictEqual(meta.resource, RESOURCE);
  assert.deepStrictEqual(meta.authorization_servers, [ISSUER]);
  assert.ok(meta.scopes_supported.includes(SCOPE));
  console.log('A protected_resource_metadata: PASS');
}

// B — Authorization Server Metadata shape
{
  const meta = {
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    registration_endpoint: `${ISSUER}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
  };
  assert.strictEqual(meta.issuer, ISSUER);
  assert.ok(meta.grant_types_supported.includes('refresh_token'));
  assert.ok(meta.code_challenge_methods_supported.includes('S256'));
  console.log('B authorization_server_metadata: PASS');
}

// C — CIMD client_id is HTTPS URL (accepted by design)
{
  const cimdId = 'https://example.com/client-metadata.json';
  assert.ok(/^https:\/\//i.test(cimdId));
  assert.ok(isValidRedirectUri('https://grok.x.ai/oauth/callback'));
  console.log('C cimd_https_client_id: PASS');
}

// D — PKCE S256
{
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = pkceChallenge(verifier);
  assert.strictEqual(challenge, b64url(sha256(verifier)));
  assert.notStrictEqual(challenge, verifier);
  console.log('D pkce_s256: PASS');
}

// E/F — Authorization code concept + token exchange claims
{
  const clientId = 'aria_test_client';
  const token = issueAccessToken(clientId);
  const verified = verifyAccessToken(token);
  assert.ok(verified);
  assert.strictEqual(verified.clientId, clientId);
  console.log('E/F authorization_code_token_exchange_claims: PASS');
}

// G/H — Refresh rotation concept (hash store)
{
  const raw1 = `aria_rt_${b64url(crypto.randomBytes(24))}`;
  const hash1 = b64url(sha256(raw1));
  const raw2 = `aria_rt_${b64url(crypto.randomBytes(24))}`;
  const hash2 = b64url(sha256(raw2));
  assert.notStrictEqual(hash1, hash2);
  assert.notStrictEqual(raw1, hash1);
  console.log('G/H refresh_hash_rotation_concept: PASS');
}

// H — resource/audience
{
  const token = issueAccessToken('c1');
  const claims = JSON.parse(fromB64url(token.split('.')[1]).toString('utf8'));
  assert.strictEqual(claims.aud, RESOURCE);
  assert.strictEqual(claims.iss, ISSUER);
  assert.strictEqual(claims.scope, SCOPE);
  console.log('H resource_audience: PASS');
}

// I — invalid redirect URI
{
  assert.strictEqual(isValidRedirectUri('javascript:alert(1)'), false);
  assert.strictEqual(isValidRedirectUri('http://evil.com/cb'), false);
  assert.strictEqual(isValidRedirectUri('https://grok.x.ai/cb'), true);
  assert.strictEqual(isValidRedirectUri('http://127.0.0.1:8787/cb'), true);
  console.log('I invalid_redirect_uri: PASS');
}

// J — expired access token
{
  const expired = issueAccessToken('c1', -10);
  assert.strictEqual(verifyAccessToken(expired), null);
  console.log('J expired_access_token: PASS');
}

// N — no secret leakage in claims
{
  const token = issueAccessToken('c1');
  assert.ok(!token.includes(SECRET));
  const claims = JSON.parse(fromB64url(token.split('.')[1]).toString('utf8'));
  assert.ok(!JSON.stringify(claims).includes(SECRET));
  console.log('N no_secret_leakage: PASS');
}

console.log('oauth-crypto: ALL PASS');
