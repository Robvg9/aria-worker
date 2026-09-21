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

async function resolveToolRoutes(agent: any) {
  const preferred = String(agent?.model?.model_id ?? agent?.model_id ?? "").trim();
  const routes:any[] = [];
  const seen=new Set<string>();
  const push=(provider:string,model:string)=>{
    const key=provider+"|"+model;
    if(model&& !seen.has(key)){seen.add(key);routes.push({provider,model});}
  };

  if (preferred.startsWith("openrouter/")) push("openrouter",preferred);

  const { data: googleModels } = await internal.from("model_registry")
    .select("model_id,status,enabled").eq("provider_id","google").eq("status","available").eq("enabled",true);
  const googleCandidates = (googleModels ?? [])
    .map((x:any)=>String(x.model_id))
    .filter((id:string)=>id.endsWith("-direct"));
  const preferredOrder = [
    "google/gemini-3.1-flash-lite-direct",
    "google/gemini-3.5-flash-direct",
    "google/gemini-3.5-flash-lite-direct",
  ];
  for (const google of preferredOrder.filter((id)=>googleCandidates.includes(id))) {
    push("google",google.slice("google/".length,-"-direct".length));
  }
  for (const google of googleCandidates) push("google",google.slice("google/".length,-"-direct".length));

  const { data: openModels } = await internal.from("model_registry")
    .select("model_id,status,enabled").eq("provider_id","openrouter").eq("status","available").eq("enabled",true);
  if (Array.isArray(openModels) && openModels.length) {
    const { data: caps } = await internal.from("capability_matrix")
      .select("model_id,status").eq("capability_id","text_generation").eq("status","verified");
    const verified = new Set((caps ?? []).map((x:any)=>String(x.model_id)));
    const candidates = openModels.map((x:any)=>String(x.model_id))
      .filter((id:string)=>verified.has(id)&&id.endsWith(":free"));
    const codeFirst = candidates.filter((id:string)=>/code|coder|coding/i.test(id));
    for (const id of [...codeFirst,...candidates]) push("openrouter",id);
  }

  if (!routes.length) throw new Error("agent_tool_model_unavailable");
  return routes.slice(0,8);
}

async function resolveToolRoute(agent: any) {
  const routes=await resolveToolRoutes(agent);
  return routes[0];
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
function canonicalToolName(name:string) {
  const value=String(name||"").trim();
  if (value.includes(":")) return value.slice(value.lastIndexOf(":")+1);
  return value;
}

const patchTool = {
  type: "function",
  function: {
    name: "github_file_patch",
    description: "Apply one exact find/replace patch to an existing file on the governed non-main repair branch. Prefer this for targeted edits; the find text must match exactly once.",
    parameters: { type: "object", properties: { path: { type: "string" }, find: { type: "string" }, replace: { type: "string" }, message: { type: "string" } }, required: ["path", "find", "replace", "message"] },
  },
};

const writeTool = {
  type: "function",
  function: {
    name: "github_file_write",
    description: "Write a complete UTF-8 file to a governed non-main repair branch. Never write main/master.",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, message: { type: "string" } }, required: ["path", "content", "message"] },
  },
};

export async function callOpenRouterModel(model:string,messages:any[],tools:any[],forceTool=false) {
  const { data: secret, error } = await internal.rpc("credential_read_secret", { p_name: "aria_openrouter_primary" });
  if (error || typeof secret !== "string" || secret.length < 10) throw new Error("openrouter_credential_unavailable");
  const toolChoice = tools.length === 0 ? undefined : (forceTool ? "required" : "auto");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${secret}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages,temperature:0,max_completion_tokens:4000,service_tier:"flex",...(tools.length?{tools,tool_choice:toolChoice}:{})})});
  const body:any=await response.json().catch(()=>null);
  if(!response.ok) throw new Error(`openrouter_http_${response.status}:${body?.error?.message??"provider_error"}`);
  return body?.choices?.[0]?.message??null;
}
function geminiContents(messages:any[]) {
  const systemParts:string[]=[]; const contents:any[]=[]; const toolNames=new Map<string,string>();
  for(const message of messages){
    const role=String(message?.role||"");
    if(role==="system"){if(typeof message?.content==="string"&&message.content.trim())systemParts.push(message.content.trim());continue;}
    if(role==="user"){contents.push({role:"user",parts:[{text:String(message?.content??"")}]});continue;}
    if(role==="assistant"){
      const exactParts=Array.isArray(message?.geminiParts)?message.geminiParts:null;
      if(exactParts&&exactParts.length){
        for(const part of exactParts){
          const call=part?.functionCall;
          if(call?.id&&call?.name)toolNames.set(String(call.id),String(call.name));
        }
        contents.push({role:"model",parts:exactParts});
        continue;
      }
      const parts:any[]=[]; if(typeof message?.content==="string"&&message.content.trim())parts.push({text:message.content});
      for(const call of Array.isArray(message?.tool_calls)?message.tool_calls:[]){
        const name=String(call?.function?.name||""); const id=String(call?.id||crypto.randomUUID()); let args:any={};
        try{args=JSON.parse(call?.function?.arguments||"{}");}catch{}
        const original=call?.geminiPart&&typeof call.geminiPart==="object"?call.geminiPart:null;
        if(original){ parts.push(original); if(name)toolNames.set(id,name); continue; }
        if(name){toolNames.set(id,name);parts.push({functionCall:{id,name,args}});}
      }
      if(parts.length)contents.push({role:"model",parts});
      continue;
    }
    if(role==="tool"){
      const callId=String(message?.tool_call_id||""); const name=toolNames.get(callId)||String(message?.name||"unknown_tool");
      let responseValue:any; try{responseValue=JSON.parse(String(message?.content??"{}"));}catch{responseValue={output:String(message?.content??"")};}
      contents.push({role:"user",parts:[{functionResponse:{id:callId||undefined,name,response:responseValue&&typeof responseValue==="object"?responseValue:{output:responseValue}}}]});
    }
  }
  return {systemInstruction:systemParts.length?{parts:[{text:systemParts.join("\n\n")}]}:undefined,contents};
}
function geminiTools(tools:any[]) {
  return tools.length?[{functionDeclarations:tools.filter((tool:any)=>tool?.type==="function"&&tool?.function?.name).map((tool:any)=>({name:String(tool.function.name),description:String(tool.function.description||""),parameters:tool.function.parameters||{type:"object",properties:{},required:[]}}))}]:undefined;
}
function geminiMessage(json:any){
  const parts=json?.candidates?.[0]?.content?.parts; if(!Array.isArray(parts))return null;
  const text=parts.filter((p:any)=>typeof p?.text==="string").map((p:any)=>p.text).join("").trim();
  const calls=parts.filter((p:any)=>p?.functionCall?.name).map((p:any)=>({
    id:String(p.functionCall.id||crypto.randomUUID()),
    type:"function",
    function:{name:String(p.functionCall.name),arguments:JSON.stringify(p.functionCall.args||{})},
    geminiPart:p,
  }));
  if(!text&&!calls.length)return null;
  return {role:"assistant",content:text,tool_calls:calls,geminiParts:parts};
}
export async function callGeminiModel(model:string,messages:any[],tools:any[],forceTool=false){
  const secret=String(Deno.env.get("GOOGLE_API_KEY")||"").trim(); if(!secret)throw new Error("google_credential_unavailable");
  const {systemInstruction,contents}=geminiContents(messages);
  const body:any={contents,generationConfig:{temperature:0,maxOutputTokens:4000}};
  if(systemInstruction)body.systemInstruction=systemInstruction;
  const declaredTools=geminiTools(tools); if(declaredTools){body.tools=declaredTools;if(forceTool)body.toolConfig={functionCallingConfig:{mode:"ANY"}};}
  const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":secret},body:JSON.stringify(body)});
  const json:any=await response.json().catch(()=>null); if(!response.ok)throw new Error(`google_http_${response.status}:${json?.error?.message??"provider_error"}`);
  return geminiMessage(json);
}
export async function callModel(model:string,messages:any[],tools:any[],forceTool=false,provider="openrouter"){
  return provider==="google"?callGeminiModel(model,messages,tools,forceTool):callOpenRouterModel(model,messages,tools,forceTool);
}
export async function toolLoop(agent: any, missionId: string, stepId: string, prompt: string, allowWrite: boolean) {
  const toolRoutes = await resolveToolRoutes(agent);
  let toolRoute = toolRoutes[0];
  const branch = `aria/repair/${missionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}`;
  const tools = allowWrite ? [...readTools, patchTool, writeTool] : readTools;
  const system = [
    `You are ARIA's governed ${agent.role} executor.`,
    "Use available tools to inspect evidence.",
    allowWrite
      ? `For changes, use only non-main branch ${branch}; never modify main/master. This is a real implementation task: you MUST inspect the repository with tools and then make a concrete mutation. Prefer github_file_patch for targeted edits; use github_file_write for new files or large replacements. For UI/PWA requests, inspect pwa/src/App.tsx and relevant style files. Do NOT return NO_CHANGE_REQUIRED unless you proved the requested behavior already exists exactly. Do not finish after analysis alone.`
      : "This is read-only: do not fabricate changes.",
    "Never claim tests, deployment, or production changes that were not actually verified.",
    "RESPONDE TODO EL TEXTO HUMANO EN ESPAÑOL. Puedes conservar únicamente los marcadores técnicos FINDINGS y VERDICT, identificadores, rutas, códigos y nombres propios exactos.",
    "Your final response is mandatory: begin with FINDINGS: and finish with VERDICT:. Include concrete evidence from the tools you actually used.",
    "Distinguish CONFIRMED, HYPOTHESIS, and BLOCKED.",
  ].join(" ");
  let messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: `Task:\n${prompt}` },
  ];
  const writes: any[] = [];
  const reads: any[] = [];
  let text = "";
  let branchCreated = false;
  let sawToolCall = false;
  for (let round = 0; round < 8; round += 1) {
    const forceTool = allowWrite && round === 0 && !sawToolCall;
    let message:any=null;
    let lastModelError:any=null;
    const candidates = (!sawToolCall && round === 0) ? toolRoutes : [toolRoute];
    for (const candidate of candidates) {
      try {
        message = await callModel(candidate.model, messages, tools, forceTool, candidate.provider);
        toolRoute = candidate;
        break;
      } catch (error) {
        lastModelError = error;
        const reason = error instanceof Error ? error.message : String(error);
        const retryableQuota = /(^|[^0-9])429([^0-9]|$)|rate.?limit|quota|too many requests/i.test(reason);
        if (!(round === 0 && !sawToolCall && retryableQuota)) throw error;
        await recordDiagnostic(missionId, stepId, { status:"fallback", code:"agent_model_quota_fallback", failed_route:candidate, message:reason, next_route:toolRoutes[toolRoutes.indexOf(candidate)+1]??null });
      }
    }
    if (!message) throw (lastModelError instanceof Error ? lastModelError : new Error("agent_model_empty"));
    text = typeof message.content === "string" ? message.content.trim() : "";
    if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
      if (allowWrite && !sawToolCall && round === 0) {
        await recordDiagnostic(missionId, stepId, {
          status: "failed",
          code: "repair_no_tool_call",
          message: "Repair path expected at least one tool call; model returned text without tools.",
          model_id: toolRoute.model,
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
      const rawName = String(toolCall?.function?.name || "");
      const name = canonicalToolName(rawName);
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
        } else if (name === "github_file_patch" && allowWrite) {
          if (!branchCreated) {
            await ghTool("create_branch", { owner: "Robvg9", repo: "aria-worker", branch, ref: "main" });
            branchCreated = true;
          }
          const patchPath = String(args.path || "");
          const patchFind = String(args.find || "");
          const patchReplace = String(args.replace ?? "");
          const patchRead = await ghTool("file_read", { owner: "Robvg9", repo: "aria-worker", branch, path: patchPath });
          const patchContent = String(patchRead?.content ?? "");
          const matchCount = patchFind ? patchContent.split(patchFind).length - 1 : 0;
          if (matchCount !== 1) {
            result = { ok: false, error: `patch_match_count_${matchCount}`, path: patchPath, branch };
          } else {
            const patchedContent = patchContent.replace(patchFind, patchReplace);
            result = await ghTool("file_write", {
              owner: "Robvg9",
              repo: "aria-worker",
              branch,
              path: patchPath,
              content: patchedContent,
              message: String(args.message || "chore: ARIA governed patch"),
              risk_level: "low",
            });
            writes.push({ path: patchPath, branch, commit_sha: result?.data?.commit_sha ?? null, operation: "github_file_patch", match_count: 1 });
          }
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
          result = { ok: false, error: `unsupported_tool:${name}`, raw_tool_name: rawName };
          await recordDiagnostic(missionId, stepId, {
            status: "failed",
            code: "agent_unsupported_tool",
            message: `Unsupported tool requested by model: ${rawName}`,
            canonical_tool_name: name,
          });
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
    const finalMessage = await callModel(toolRoute.model, messages, [], false, toolRoute.provider);
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
    await recordDiagnostic(missionId, stepId, {
      status: "failed",
      code: "repair_no_mutation",
      message: "Implementation mission returned NO_CHANGE_REQUIRED without a concrete mutation.",
      reads_count: reads.length,
      writes_count: writes.length,
      summary: text.slice(0, 8000),
    });
    return {
      status: "failed",
      executor_type: "agent",
      agent_id: agent.agent_id,
      role: agent.role,
      response: { content: text },
      error: { code: "repair_no_mutation", message: "Implementation mission cannot finish as NO_CHANGE_REQUIRED without proving the requested behavior already exists exactly." },
      repair: { branch, changed: false, writes: [], reads, summary: text, verified: false, verification_status: "failed" },
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
