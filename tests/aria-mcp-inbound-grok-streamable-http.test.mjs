import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRejectMcpGet } from "../supabase/functions/aria-mcp-inbound-grok-v1/transport.mjs";

const get = (headers = {}) => new Request(
  "https://example.test/functions/v1/aria-mcp-inbound-grok-v1",
  { method: "GET", headers },
);

assert.equal(shouldRejectMcpGet(get({ accept: "text/event-stream", "mcp-protocol-version": "2025-11-25" })), true);
assert.equal(shouldRejectMcpGet(get({ accept: "application/json", "mcp-protocol-version": "2026-07-28" })), true);
assert.equal(shouldRejectMcpGet(get({ accept: "application/json", "mcp-protocol-version": "2025-11-25" })), false);
assert.equal(shouldRejectMcpGet(get({ accept: "application/json, text/event-stream;q=0" })), false);
assert.equal(shouldRejectMcpGet(get({ accept: "application/json, text/event-stream;q=0.5" })), true);
assert.equal(shouldRejectMcpGet(get({ accept: "text/event-stream" })), true);

const source = readFileSync(
  new URL("../supabase/functions/aria-mcp-inbound-grok-v1/index.ts", import.meta.url),
  "utf8",
);
assert.ok(source.includes('import { shouldRejectMcpGet } from "./transport.mjs";'));
const metadataRoute = source.indexOf('path.includes("/.well-known/oauth-protected-resource")');
const guard = source.indexOf("shouldRejectMcpGet(req)");
const genericGet = source.lastIndexOf('if (req.method === "GET" || req.method === "HEAD")');
assert.ok(metadataRoute >= 0 && metadataRoute < guard, "OAuth metadata GET must remain ahead of the MCP GET guard");
assert.ok(guard >= 0 && guard < genericGet, "MCP GET guard must precede the legacy JSON GET response");
assert.ok(source.includes('reason: "get_stream_not_supported"'));
assert.ok(source.includes('{ allow: "POST, OPTIONS" }'));
console.log("PASS aria-mcp-inbound-grok Streamable HTTP GET contract");
