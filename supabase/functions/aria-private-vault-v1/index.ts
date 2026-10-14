import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import {
  isUuid,
  parseOptionalRevision,
  parsePagination,
  validateRecordPayload,
  validateVaultConfig,
  MAX_REQUEST_BYTES,
} from "../_shared/private-vault-contract.ts";

const FUNCTION_SLUG = "aria-private-vault-v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const PUBLIC_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
  Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ALLOWED_ORIGINS = new Set([
  "https://aria.robvg9.workers.dev",
  "http://localhost:5173",
  "http://localhost:8787",
  "http://localhost:8788",
]);
const VAULT_CONFIG_SELECT =
  "vault_id,format_version,kdf_id,kdf_params,kdf_salt,password_wrap_nonce,wrapped_vault_key,recovery_wrap_nonce,recovery_wrapped_vault_key,created_at,updated_at";
const RECORD_META_SELECT = "record_id,revision,format_version,payload_nonce,created_at";
const RECORD_BLOB_SELECT =
  "vault_id,record_id,revision,format_version,payload_nonce,ciphertext,created_at";

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function headersFor(origin: string | null): Headers {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, private",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "vary": "Origin",
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "GET,PUT,OPTIONS");
    headers.set("access-control-allow-headers", "authorization,apikey,x-client-info,content-type");
    headers.set("access-control-max-age", "600");
  }
  return headers;
}

function reply(
  status: number,
  body: unknown,
  origin: string | null,
  requestId: string,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = headersFor(origin);
  headers.set("x-aria-vault-request-id", requestId);
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

function extractSegments(url: URL): string[] {
  const all = url.pathname.split("/").filter(Boolean);
  const functionIndex = all.lastIndexOf(FUNCTION_SLUG);
  return functionIndex >= 0 ? all.slice(functionIndex + 1) : all;
}

function resolveAction(method: string, parts: string[]): string {
  if (parts[0] !== "vaults") return "request.rejected";
  if (parts.length === 1 && method === "GET") return "vault.list";
  if (parts.length === 2 && isUuid(parts[1])) {
    if (method === "GET") return "vault.read";
    if (method === "PUT") return "vault.config";
  }
  if (parts.length === 3 && isUuid(parts[1]) && parts[2] === "records" && method === "GET") {
    return "record.list";
  }
  if (parts.length === 4 && isUuid(parts[1]) && parts[2] === "records" && isUuid(parts[3])) {
    if (method === "GET") return "record.read";
    if (method === "PUT") return "record.write";
  }
  return "request.rejected";
}

function rateAction(action: string): string {
  if (action === "vault.config") return "vault.config";
  if (action === "record.write") return "vault.write";
  return "vault.read";
}

function resourceIdFor(parts: string[]): string | null {
  if (parts[0] !== "vaults") return null;
  if (parts.length >= 4 && parts[2] === "records" && isUuid(parts[3])) return parts[3];
  if (parts.length >= 2 && isUuid(parts[1])) return parts[1];
  return null;
}

async function parseJsonBounded(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new ApiError(413, "payload_too_large");
  }
  if (!request.body) throw new ApiError(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json");
  }
}

function outcomeFor(status: number): string {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "error";
  return "denied";
}

async function appendAudit(
  admin: ReturnType<typeof createClient>,
  ownerId: string,
  requestId: string,
  action: string,
  outcome: string,
  resourceId: string | null,
  statusCode: number | null,
): Promise<string | null> {
  const { data, error } = await admin
    .from("aria_vault_audit_events")
    .insert({
      owner_id: ownerId,
      request_id: requestId,
      action,
      outcome,
      resource_id: resourceId,
      status_code: statusCode,
    })
    .select("id")
    .single();
  if (error || !data?.id) return null;
  return String(data.id);
}

async function finalizeAudit(
  admin: ReturnType<typeof createClient>,
  ownerId: string,
  auditId: string,
  status: number,
  requestId: string,
): Promise<void> {
  const { error } = await admin
    .from("aria_vault_audit_events")
    .update({ outcome: outcomeFor(status), status_code: status })
    .eq("id", auditId)
    .eq("owner_id", ownerId);
  if (error) {
    // Do not log provider messages, request bodies, ciphertext, keys or user content.
    console.error("aria_private_vault_audit_finalize_failed", { requestId, code: error.code ?? "unknown" });
  }
}

async function rateGate(
  admin: ReturnType<typeof createClient>,
  ownerId: string,
  action: string,
): Promise<{ allowed: boolean; retryAfter: number } | null> {
  const { data, error } = await admin.rpc("aria_vault_consume_rate_limit_v1", {
    p_owner_id: ownerId,
    p_action: action,
  });
  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (typeof row?.allowed !== "boolean" || !Number.isInteger(row?.retry_after_seconds)) return null;
  return { allowed: row.allowed, retryAfter: Math.max(1, row.retry_after_seconds) };
}

async function parseRouteBody(request: Request): Promise<unknown> {
  return await parseJsonBounded(request);
}

async function ensureOwnedVault(admin: ReturnType<typeof createClient>, ownerId: string, vaultId: string) {
  const { data, error } = await admin
    .from("aria_vault_vaults")
    .select("vault_id")
    .eq("owner_id", ownerId)
    .eq("vault_id", vaultId)
    .maybeSingle();
  if (error) throw new ApiError(503, "storage_unavailable");
  if (!data) throw new ApiError(404, "vault_not_found");
}

async function dispatch(
  request: Request,
  url: URL,
  parts: string[],
  action: string,
  admin: ReturnType<typeof createClient>,
  ownerId: string,
  origin: string | null,
  requestId: string,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const bad = (status: number, code: string) => reply(status, { error: code }, origin, requestId);

  if (method !== "GET" && method !== "PUT") return bad(405, "method_not_allowed");
  if (parts[0] !== "vaults") return bad(404, "route_not_found");

  // GET /vaults?limit=&offset=
  if (parts.length === 1 && method === "GET" && action === "vault.list") {
    const page = parsePagination(url);
    if (!page) return bad(400, "invalid_pagination");
    const { data, error } = await admin
      .from("aria_vault_vaults")
      .select(VAULT_CONFIG_SELECT)
      .eq("owner_id", ownerId)
      .order("created_at", { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new ApiError(503, "storage_unavailable");
    const vaults = data ?? [];
    return reply(200, {
      vaults,
      limit: page.limit,
      offset: page.offset,
      next_offset: vaults.length === page.limit ? page.offset + page.limit : null,
    }, origin, requestId);
  }

  const vaultId = parts[1];
  if (!isUuid(vaultId)) return bad(400, "invalid_vault_id");

  // GET/PUT /vaults/:vaultId
  if (parts.length === 2) {
    if (method === "GET" && action === "vault.read") {
      const { data, error } = await admin
        .from("aria_vault_vaults")
        .select(VAULT_CONFIG_SELECT)
        .eq("owner_id", ownerId)
        .eq("vault_id", vaultId)
        .maybeSingle();
      if (error) throw new ApiError(503, "storage_unavailable");
      if (!data) return bad(404, "vault_not_found");
      return reply(200, { vault: data }, origin, requestId);
    }

    if (method === "PUT" && action === "vault.config") {
      const body = await parseRouteBody(request);
      const config = validateVaultConfig(body, vaultId);
      if (!config) return bad(400, "invalid_vault_config");
      const { error } = await admin
        .from("aria_vault_vaults")
        .upsert({
          owner_id: ownerId,
          vault_id: vaultId,
          ...config,
          updated_at: new Date().toISOString(),
        }, { onConflict: "owner_id,vault_id" });
      if (error) throw new ApiError(503, "storage_unavailable");
      return reply(200, { saved: true, vault_id: vaultId, format_version: 1 }, origin, requestId);
    }
    return bad(405, "method_not_allowed");
  }

  if (parts.length >= 3 && parts[2] === "records") {
    await ensureOwnedVault(admin, ownerId, vaultId);
  }

  // GET /vaults/:vaultId/records?limit=&offset=
  if (parts.length === 3 && method === "GET" && action === "record.list") {
    const page = parsePagination(url);
    if (!page) return bad(400, "invalid_pagination");
    const { data, error } = await admin
      .from("aria_vault_records")
      .select(RECORD_META_SELECT)
      .eq("owner_id", ownerId)
      .eq("vault_id", vaultId)
      .order("record_id", { ascending: true })
      .order("revision", { ascending: false })
      .range(page.offset, page.offset + page.limit - 1);
    if (error) throw new ApiError(503, "storage_unavailable");
    const records = data ?? [];
    return reply(200, {
      records,
      limit: page.limit,
      offset: page.offset,
      next_offset: records.length === page.limit ? page.offset + page.limit : null,
    }, origin, requestId);
  }

  const recordId = parts[3];
  if (parts.length !== 4 || !isUuid(recordId)) return bad(404, "route_not_found");

  // GET /vaults/:vaultId/records/:recordId?revision=N
  if (method === "GET" && action === "record.read") {
    const requestedRevision = parseOptionalRevision(url);
    if (requestedRevision === null) return bad(400, "invalid_revision");
    let query = admin
      .from("aria_vault_records")
      .select(RECORD_BLOB_SELECT)
      .eq("owner_id", ownerId)
      .eq("vault_id", vaultId)
      .eq("record_id", recordId);
    if (requestedRevision !== undefined) {
      query = query.eq("revision", requestedRevision);
    } else {
      query = query.order("revision", { ascending: false }).limit(1);
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw new ApiError(503, "storage_unavailable");
    if (!data) return bad(404, "record_not_found");
    return reply(200, { record: data }, origin, requestId);
  }

  // PUT /vaults/:vaultId/records/:recordId. A revision is append-only; no overwrite/delete.
  if (method === "PUT" && action === "record.write") {
    const body = await parseRouteBody(request);
    const payload = validateRecordPayload(body);
    if (!payload) return bad(400, "invalid_record_payload");
    const { error } = await admin
      .from("aria_vault_records")
      .insert({
        owner_id: ownerId,
        vault_id: vaultId,
        record_id: recordId,
        ...payload,
      });
    if (error?.code === "23505") return bad(409, "revision_already_exists");
    if (error?.code === "23503") return bad(404, "vault_not_found");
    if (error) throw new ApiError(503, "storage_unavailable");
    return reply(201, { saved: true, record_id: recordId, revision: payload.revision }, origin, requestId);
  }

  return bad(405, "method_not_allowed");
}

Deno.serve(async (request: Request): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin");

  if (request.method.toUpperCase() === "OPTIONS") {
    return new Response(null, { status: 204, headers: headersFor(origin) });
  }
  if (!SUPABASE_URL || !PUBLIC_KEY || !SERVICE_ROLE_KEY) {
    return reply(503, { error: "vault_api_not_configured" }, origin, requestId);
  }

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!bearer) return reply(401, { error: "authentication_required" }, origin, requestId);

  const identityClient = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  let ownerId: string;
  try {
    const { data, error } = await identityClient.auth.getUser(bearer);
    if (error || !data?.user?.id) {
      return reply(401, { error: "authentication_required" }, origin, requestId);
    }
    ownerId = data.user.id;
  } catch {
    return reply(401, { error: "authentication_required" }, origin, requestId);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const url = new URL(request.url);
  const parts = extractSegments(url);
  const action = resolveAction(request.method.toUpperCase(), parts);
  const resourceId = resourceIdFor(parts);

  try {
    const gate = await rateGate(admin, ownerId, rateAction(action));
    if (!gate) return reply(503, { error: "rate_limit_unavailable" }, origin, requestId);
    if (!gate.allowed) {
      const auditId = await appendAudit(admin, ownerId, requestId, action, "rate_limited", resourceId, 429);
      if (!auditId) return reply(503, { error: "audit_unavailable" }, origin, requestId);
      return reply(429, { error: "rate_limited", retry_after_seconds: gate.retryAfter }, origin, requestId, {
        "retry-after": String(gate.retryAfter),
      });
    }

    const auditId = await appendAudit(admin, ownerId, requestId, action, "started", resourceId, null);
    if (!auditId) return reply(503, { error: "audit_unavailable" }, origin, requestId);

    let response: Response;
    try {
      response = await dispatch(request, url, parts, action, admin, ownerId, origin, requestId);
    } catch (error) {
      if (error instanceof ApiError) {
        response = reply(error.status, { error: error.code }, origin, requestId);
      } else {
        const code = (error && typeof error === "object" && "code" in error &&
          typeof (error as { code?: unknown }).code === "string")
          ? (error as { code: string }).code
          : "unknown";
        console.error("aria_private_vault_storage_error", { requestId, code });
        response = reply(503, { error: "storage_unavailable" }, origin, requestId);
      }
    }
    await finalizeAudit(admin, ownerId, auditId, response.status, requestId);
    return response;
  } catch (error) {
    const code = (error && typeof error === "object" && "code" in error &&
      typeof (error as { code?: unknown }).code === "string")
      ? (error as { code: string }).code
      : "unknown";
    console.error("aria_private_vault_request_failed", { requestId, code });
    return reply(503, { error: "vault_api_unavailable" }, origin, requestId);
  }
});
