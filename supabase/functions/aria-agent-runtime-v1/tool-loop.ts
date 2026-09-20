import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("ARIA_RUNTIME_SHARED_SECRET") ?? "";
const GH = `${URL}/functions/v1/aria-github-app-runtime-v1`;
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, autoRefreshSession: false } });
const internal = sb.schema("aria_internal");

type CatalogAgent = { agent_id: string; role: string; capabilities: string[]; scope: string[]; max_risk: string; status: string; model_id: string };

async function recordDiagnostic(missionId: string, stepId: string, payload: Record<string, unknown>) {
  try {
    await internal.from("mission_events").insert({
      mission_id: missionId,
      step_index: null,
      event_type: "agent_executor_diagnostic",
      payload: { mission_id: missionId, step_id: stepId, ...payload },
    });
  } catch {}
}

async function resolveToolModel(agent: any) {
  const preferred = String(agent?.model?.model_id ?? agent?.model_id ?? "").trim();
  if (preferred.startsWith("openrouter/")) return preferred;
  if (preferred && preferred.includes(":free") && !preferred.startsWith("google/")) return preferred;

  const { data, error } = await internal
    .from("model_registry")
    .select("model_id,provider_id,status,enabled")
    .eq("provider_id", "openrouter")
    .eq("status", "available")
    .eq("enabled", true);

  if (!error && Array.isArray(data) && data.length) {
    const { data: caps } = await internal
      .from("capability_matrix")
      .select("model_id,status")
      .eq("capability_id", "text_generation")
      .eq("status", "verified");

    const verified = new Set((caps ?? []).map((x: any) => String(x.model_id)));
    const candidates = data
      .map((x: any) => String(x.model_id))
      .filter((id: string) => verified.has(id) && id.endsWith(":free"));

    const codeFirst = candidates.find((id: string) => /code|coder|coding/i.test(id));
    if (codeFirst) return codeFirst;
    if (candidates[0]) return candidates[0];
  }

  throw new Error("agent_tool_model_unavailable");
}

function b64decode(s: string) {
  const clean = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = clean + "=".repeat((4 - clean.length % 4) % 4);
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function ghTool(operation: string, args: Record<string, unknown>) {
  const response = await fetch(GH, {
    method: "POST",
    headers: { "content-type": "application/json", "x-aria-autonomy-token": SECRET },
    body: JSON.stringify({ operation, ...args }),
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok || body?.ok !== true) throw new Error(String(body?.error || `github_tool_http_${response.status}`));
  if (operation === "file_read") {
    const d = body.data;
    return {
      ok: true,
      operation,
      path: args.path,
      branch: args.branch ?? "main",
      content: d?.content ? b64decode(String(d.content)) : null,
      sha: d?.sha ?? null,
    };
  }
  return { ok: true, operation, data: body.data ?? null };
}

const readTools = [
  { type: "function", function: { name: "github_tree_read", description: "List repository source paths from Robvg9/aria-worker on main.", parameters: { type: "object", properties: {}, required: [] } } },
  { type: "function", function: { name: "github_code_search", description: "Search source code in Robvg9/aria-worker on main.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "github_file_read", description: "Read a text file from Robvg9/aria-worker.", parameters: { type: "object", properties: { path: { type: "string" }, branch: { type: "string" } }, required: ["path"] } } },
];
const writeTool = {
  type: "function",
  function: {
    name: "github_file_write",
    description: "Write a complete UTF-8 file to a governed non-main repair branch. Never write main/master.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"] },
  },
};

export async function callModel(model: string, messages: any[], tools: any[], forceTool = false) {
  const { data: secret, error } = await internal.rpc("credential_read_secret", { p_name: "aria_openrouter_primary" });
  if (error || typeof secret !== "string" || secret.length < 10) throw new Error("openrouter_credential_unavailable");
  const toolChoice = tools.length === 0 ? undefined : (forceTool ? "required" : "auto");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_completion_tokens: 1200,
      service_tier: "flex",
      ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
    }),
  });
  const body: any = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`openrouter_http_${response.status}:${body?.error?.message ?? "provider_error"}`);
  return body?.choices?.[0]?.message ?? null;
}

export async function toolLoop(agent: any, missionId: string, stepId: string, prompt: string, allowWrite: boolean) {
  const toolModel = await resolveToolModel(agent);
  const branch = `aria/repair/${missionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}`;
  const tools = allowWrite ? [...readTools, writeTool] : readTools;
  const system = [
    `You are ARIA's governed ${agent.role} executor.`,
    "Use available tools to inspect evidence.",
    allowWrite
      ? `For changes, use only non-main branch ${branch}; never modify main/master. A concrete write is required for a repair unless NO_CHANGE_REQUIRED is justified.`
      : "This is read-only: do not fabricate changes.",
    "Never claim tests, deployment, or production changes that were not actually verified.",
    "Your final response is mandatory: begin with FINDINGS: and finish with VERDICT:. Include concrete evidence from the tools you actually used.",
    "Distinguish CONFIRMED, HYPOTHESIS, and BLOCKED.",
  ].join(" ");
  let messages: any[] = [{ role: "system", content: `${system}\n\nTask:\n${prompt}` }];
  const writes: any[] = [];
  const reads: any[] = [];
  let text = "";
  let branchCreated = false;
  let sawToolCall = false;
  for (let round = 0; round < 8; round += 1) {
    const forceTool = allowWrite && round === 0 && !sawToolCall;
    const message = await callModel(toolModel, messages, tools, forceTool);
    if (!message) throw new Error("agent_model_empty");
    text = typeof message.content === "string" ? message.content.trim() : "";
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      if (allowWrite && !sawToolCall && round === 0) {
        await recordDiagnostic(missionId, stepId, {
          status: "failed",
          code: "repair_no_tool_call",
          message: "Repair path expected at least one tool call; model returned text without tools.",
          model_id: toolModel,
          tool_choice_requested: "required",
        });
        return {
          status: "failed",
          executor_type: "agent",
          agent_id: agent.agent_id,
          role: agent.role,
          response: { content: text || "repair_no_tool_call" },
          error: {
            code: "repair_no_tool_call",
            message: "Model produced no tool call despite tool_choice=required. Do not treat text as mutation.",
          },
          repair: { branch, changed: false, writes: [], reads: [], verified: false, verification_status: "failed" },
        };
      }
      break;
    }
    sawToolCall = true;
    messages.push(message);
    for (const toolCall of message.tool_calls.slice(0, 4)) {
      const name = String(toolCall?.function?.name || "");
      let args: any = {};
      try { args = JSON.parse(toolCall?.function?.arguments || "{}"); } catch { args = {}; }
      let result: any;
      try {
        if (name === "github_tree_read") {
          result = await ghTool("tree_read", { owner: "Robvg9", repo: "aria-worker", branch: "main" });
          reads.push({ operation: name });
        } else if (name === "github_code_search") {
          result = await ghTool("code_search", { owner: "Robvg9", repo: "aria-worker", query: String(args.query || "") });
          reads.push({ operation: name, query: String(args.query || "") });
        } else if (name === "github_file_read") {
          const readBranch = String(args.branch || "main");
          result = await ghTool("file_read", { owner: "Robvg9", repo: "aria-worker", branch: readBranch, path: String(args.path || "") });
          reads.push({ operation: name, path: String(args.path || ""), branch: readBranch });
        } else if (name === "github_file_write" && allowWrite) {
          if (!branchCreated) {
            await ghTool("create_branch", { owner: "Robvg9", repo: "aria-worker", branch, ref: "main" });
            branchCreated = true;
          }
          result = await ghTool("file_write", {
            owner: "Robvg9",
            repo: "aria-worker",
            branch,
            path: String(args.path || ""),
            content: String(args.content ?? ""),
            message: String(args.message || "chore: ARIA governed repair"),
            risk_level: "low",
          });
          writes.push({ path: String(args.path || ""), branch, commit_sha: result?.data?.commit_sha ?? null });
        } else {
          result = { ok: false, error: `unsupported_tool:${name}` };
        }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result).slice(0, 12000) });
      if (result?.ok === false && String(result?.error || "").includes("github_404")) {
        await recordDiagnostic(missionId, stepId, {
          status: "blocked",
          code: "github_write_permission_or_installation_scope",
          message: String(result.error),
          operation: name,
          branch,
        });
      }
    }
    if (writes.length >= 6) break;
  }
  if (!/^FINDINGS:/i.test(text) || !/VERDICT:/i.test(text)) {
    messages.push({
      role: "user",
      content: "You have finished tool inspection. Now produce the mandatory final report using only the evidence in this conversation. Begin exactly with FINDINGS: and finish with VERDICT:. Do not call any more tools. Do not claim any change/test/deployment you did not verify.",
    });
    const finalMessage = await callModel(toolModel, messages, []);
    text = typeof finalMessage?.content === "string" ? finalMessage.content.trim() : "";
  }
  if (!/^FINDINGS:/i.test(text) || !/VERDICT:/i.test(text)) {
    await recordDiagnostic(missionId, stepId, {
      status: "failed",
      code: "agent_final_report_missing",
      message: "Tool-capable agent completed without mandatory FINDINGS/VERDICT report",
      reads_count: reads.length,
      writes_count: writes.length,
    });
    return {
      status: "failed",
      executor_type: "agent",
      agent_id: agent.agent_id,
      role: agent.role,
      response: { content: text || "agent_final_report_missing" },
      error: { code: "agent_final_report_missing", message: "Mandatory final evidence report was not produced" },
      repair: { branch, changed: writes.length > 0, writes, reads, verified: false, verification_status: "failed" },
    };
  }
  if (writes.length > 0) {
    const pr = await ghTool("open_pr", {
      owner: "Robvg9",
      repo: "aria-worker",
      branch,
      base: "main",
      title: `ARIA repair: ${missionId}`,
      body: `Governed repair mission ${missionId}.\n\nChanged files:\n${writes.map((x) => `- ${x.path}`).join("\n")}\n\nAgent report:\n${text.slice(0, 8000)}`,
    });
    return {
      status: "succeeded",
      executor_type: "agent",
      agent_id: agent.agent_id,
      role: agent.role,
      response: { content: text },
      repair: {
        branch,
        changed: true,
        writes,
        reads,
        pr: pr.data ?? null,
        summary: text,
        verified: false,
        verification_status: "awaiting_ci_or_live_verification",
      },
    };
  }
  if (/\bBLOCKED\b/i.test(text)) {
    return {
      status: "blocked",
      executor_type: "agent",
      agent_id: agent.agent_id,
      role: agent.role,
      response: { content: text },
      repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "blocked" },
      error: { code: "repair_blocked", message: text.slice(0, 12000) },
    };
  }
  if (!allowWrite) {
    return {
      status: "succeeded",
      executor_type: "agent",
      agent_id: agent.agent_id,
      role: agent.role,
      response: { content: text },
      repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "evidence_only" },
    };
  }
  if (/NO_CHANGE_REQUIRED/i.test(text)) {
    return {
      status: "succeeded",
      executor_type: "agent",
      agent_id: agent.agent_id,
      role: agent.role,
      response: { content: text },
      repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "unverified" },
    };
  }
  return {
    status: "failed",
    executor_type: "agent",
    agent_id: agent.agent_id,
    role: agent.role,
    response: { content: text },
    error: {
      code: "repair_no_mutation",
      message: "Repair mission produced a final report but no concrete mutation and was not classified as NO_CHANGE_REQUIRED or BLOCKED",
    },
    repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "failed" },
  };
}
