#!/usr/bin/env python3
from pathlib import Path

p = Path("supabase/functions/aria-mcp-inbound-grok-v1/index.ts")
s = p.read_text()
assert "issueAccessToken" in s and "tools/call" in s

old = '''const RESOURCE =
  Deno.env.get("ARIA_MCP_INBOUND_RESOURCE") ??
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";

const ISSUER = RESOURCE;'''

new = '''const RESOURCE =
  Deno.env.get("ARIA_MCP_INBOUND_RESOURCE") ??
  "https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-mcp-inbound-grok-v1";

// Worker facade: RESOURCE=.../mcp (aud), ISSUER=Worker origin (iss / AS id).
const ISSUER =
  Deno.env.get("ARIA_MCP_INBOUND_ISSUER") ??
  RESOURCE;'''

if old not in s:
    raise SystemExit("RESOURCE/ISSUER block missing")
s = s.replace(old, new, 1)

old2 = '''function wwwAuthenticate(): string {
  const meta = `${RESOURCE}/.well-known/oauth-protected-resource`;
  return `Bearer realm="aria-mcp-inbound", resource="${RESOURCE}", resource_metadata="${meta}"`;
}'''

new2 = '''function wwwAuthenticate(): string {
  const meta =
    ISSUER !== RESOURCE
      ? `${ISSUER}/.well-known/oauth-protected-resource/mcp`
      : `${RESOURCE}/.well-known/oauth-protected-resource`;
  return `Bearer realm="aria-mcp-inbound", resource="${RESOURCE}", resource_metadata="${meta}"`;
}'''

if old2 not in s:
    raise SystemExit("wwwAuthenticate missing")
s = s.replace(old2, new2, 1)

marker = '  if (req.method === "OPTIONS") {\n'
guard = '''  // Grok Web requires the OAuth challenge during the initial MCP handshake.
  const publicOAuthPath =
    path.includes("/.well-known/oauth-protected-resource") ||
    path.includes("/.well-known/oauth-authorization-server") ||
    path.endsWith("/register") ||
    path.endsWith("/authorize") ||
    path.endsWith("/authorize/consent") ||
    path.endsWith("/token");

  if (!publicOAuthPath && req.method !== "OPTIONS") {
    const access = await verifyAccessToken(bearer(req));
    if (!access) {
      return json(401, { error: "unauthorized" }, {
        "WWW-Authenticate": wwwAuthenticate(),
      });
    }
  }

'''

if guard.strip() not in s and marker in s:
    s = s.replace(marker, guard + marker, 1)

p.write_text(s)
print("patched", len(s))
