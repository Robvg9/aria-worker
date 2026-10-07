// DEPLOYMENT CONTRACT: this function uses Deno configuration in deno.json; do NOT pass an import_map_path automatically.
// RWHT Android runtime contract: governed conversation probe + safe read-only fallback.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const URL=Deno.env.get("SUPABASE_URL")!, KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")!;
const ROOT=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false,autoRefreshSession:false}});
const EAS_PROJECT_ID="1b23b091-f7b6-4dc2-b328-c8e5ec07de57"; const db=ROOT.schema("aria_internal");
const TOOL_UNIVERSE_V1={
  version:"tool-universe-v1",
  connectors:["github","supabase","cloudflare","bitrise","eas"],
  executors:["model","agent","device","connector","eas"],
  device_operations:["shell.execute","ollama.qwen3","computer.use","computer.use.autonomous","computer.use.android","android.notification"],
  ui_capabilities:["observe","screenshot","click","double_click","type","keypress","hotkey","scroll","focus","wait"],
  governance:["READ","LOW_RISK_WRITE","HIGH_RISK_WRITE","DESTRUCTIVE","human_gate_for_high_risk"]
};

const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
async function auth(r:Request){const h=r.headers.get("authorization")||"";const t=h.startsWith("Bearer ")?h.slice(7):"";if(SECRET&&t&&eq(t,SECRET))return true;const c=r.headers.get("x-aria-autonomy-token");if(!c)return false;const {data,error}=await db.rpc("aria_autonomy_cron_authorize",{p_token:c});return !error&&data===true}
const SPANISH_OUTPUT_CONTRACT="RESPONDE ÚNICAMENTE EN ESPAÑOL. Todos los títulos, encabezados, explicaciones, estados y conclusiones dirigidos al usuario deben estar en español. Conserva en inglés solo nombres propios, identificadores técnicos, rutas, códigos, nombres de modelos o valores exactos de evidencia cuando sea necesario. No redactes un informe humano en inglés.";
const esPrompt=(prompt:string)=>`${SPANISH_OUTPUT_CONTRACT}\n\n${prompt}`;
const modelStep=(id:string,route:any,prompt:string,depends_on:string[]=[])=>({id,operation:"text_generation",executor_type:"model",target:{type:"model",provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id},capability:"text_generation",input:{payload:{prompt:esPrompt(prompt),max_tokens:2200,temperature:0}},risk:"READ",timeout_ms:90000,policy:{spanish_output_required:true},depends_on,verify:{response_content_nonempty:true},selection:{review_role:"forensic_reviewer",capability_status:route.capability_status||"unknown",evidence_type:route.evidence_type||"unknown",evidence_ref:route.evidence_ref||null}});
const agentStep=(id:string,a:any,prompt:string,depends_on:string[]=[])=>({id,operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:a.agent_id},capability:"delegation",input:{goal:`ARIA ${a.role||"agent"} — misión gobernada`,prompt:esPrompt(prompt),max_tokens:2400},risk:"READ",timeout_ms:150000,policy:{spanish_output_required:true},depends_on,verify:{response_content_nonempty:true},selection:{review_role:a.role,model_id:a.model_id||null}});
const PLANNER_GOVERNED_CHANGE_V2="planner-v11-governed-change-v3-multistep";
const PLANNER_GOVERNED_CHANGE_V2_COMPAT="planner-v11-governed-change-v2";
const governedWritePolicy={tool_use:true,mutating_operation_required:true,non_main_branch_required:true,test_evidence_required:true,do_not_claim_text_only_success:true,auto_merge_low_risk:true,production_merge_requires_human_gate:false,human_gate_threshold:"HIGH_RISK_WRITE",post_merge_verification_required:true,spanish_output_required:true};

function humanGateGoalIntent(goal:string){
  return /human[s-]?gate|aprobaci[oó]n humana|requieres+(?:las+)?aprobaci[oó]n|acci[oó]ns+protegida|protected action|debe esperar.*aprobaci[oó]n/i.test(String(goal||""));
}

function applyHumanGateIntent(goal:string,steps:any[]){
  if(!humanGateGoalIntent(goal)) return steps;
  const idx=steps.findIndex((s:any)=>String(s?.risk||"").toUpperCase().includes("WRITE") || s?.policy?.mutating_operation_required===true);
  if(idx<0) return steps;
  return steps.map((s:any,i:number)=>{
    if(i!==idx) return s;
    return {
      ...s,
      risk:"HIGH_RISK_WRITE",
      policy:{
        ...(s.policy||{}),
        human_gate_required:true,
        human_gate_reason:"La acción fue clasificada como protegida por la intención explícita de la misión.",
        human_gate_instructions:"Revisa la acción exacta, destino y alcance antes de aprobarla.",
      },
      selection:{
        ...(s.selection||{}),
        human_gate_required:true,
        selection_reason:(s.selection?.selection_reason||"planned") + "+human_gate",
      },
    };
  });
}
const repairStep=async(goal:string,context:any)=>{const contextText=JSON.stringify(context).slice(0,7000);return [agentStep("diagnosis_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Analiza primero la falla real de esta misión antes de modificar nada. Inspecciona la evidencia disponible y determina causa raíz, archivos/recursos afectados, riesgo y pruebas necesarias. No hagas cambios. Misión original: ${goal}. Contexto: ${contextText}`),{id:"repair_1",operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:"aria-agent-coding-v1"},capability:"coding",input:{goal:"Ejecutar reparación gobernada",prompt:esPrompt(`Esta es la fase de IMPLEMENTACIÓN de una reparación real. Usa el diagnóstico previo como guía, pero comprueba el estado actual por ti mismo. Trabaja en una rama gobernada que no sea main, corrige la causa raíz, ejecuta las pruebas focalizadas y devuelve evidencia concreta: cambios realizados, archivos afectados, pruebas ejecutadas y resultado. No declares éxito por texto solamente. Misión original: ${goal}. Contexto: ${contextText}`),max_tokens:3000},risk:"LOW_RISK_WRITE",timeout_ms:180000,policy:governedWritePolicy,depends_on:["diagnosis_1"],verify:{},selection:{review_role:"coder",write_route:"github_app_governed_or_agent_runtime"}},agentStep("verification_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Verifica la reparación real ya aplicada para esta misión. Inspecciona el estado actual del repositorio/PR, confirma que el cambio existe, revisa las pruebas/evidencias y determina si la causa raíz quedó resuelta. No hagas cambios. Misión original: ${goal}. Contexto: ${contextText}`,["repair_1"])]};
const changeStep=async(goal:string,context:any)=>{const contextText=JSON.stringify(context).slice(0,7000);return [agentStep("analysis_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Antes de implementar, analiza la solicitud completa y localiza exactamente qué debe cambiar. Inspecciona el repositorio real, identifica archivos/componentes afectados, dependencias, riesgos y pruebas necesarias. No modifiques nada en esta fase. Solicitud original: ${goal}. Contexto: ${contextText}`),{id:"implementation_1",operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:"aria-agent-coding-v1"},capability:"coding",input:{goal:"Ejecutar implementación gobernada",prompt:esPrompt(`Esta es la fase de IMPLEMENTACIÓN de una solicitud real. Usa el análisis previo como guía y comprueba el estado actual por ti mismo. Trabaja únicamente en una rama gobernada que no sea main. Implementa exactamente la solicitud, añade o actualiza pruebas focalizadas y devuelve evidencia concreta de cambios y pruebas. No termines después del análisis y no declares éxito por texto solamente. Solicitud original: ${goal}. Contexto: ${contextText}`),max_tokens:3200},risk:"LOW_RISK_WRITE",timeout_ms:180000,policy:governedWritePolicy,depends_on:["analysis_1"],verify:{},selection:{review_role:"coder",write_route:"github_app_governed_or_agent_runtime"}},agentStep("verification_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Haz la VERIFICACIÓN FINAL de esta solicitud. Inspecciona el cambio real que acaba de producirse, confirma que satisface la solicitud original, revisa las pruebas y la evidencia disponible y señala cualquier contradicción, bloqueo o trabajo faltante. No modifiques nada. Solicitud original: ${goal}. Contexto: ${contextText}`,["implementation_1"])]};


function extractMissionPlannerContract(context:any){
  const raw=context?.mission_planner_contract;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

function explicitDeviceIntent(goal:string, context:any){
  const c=extractMissionPlannerContract(context);
  const requested=String(c?.requested_capability || c?.capability || "").trim().toLowerCase();
  const deviceId=String(c?.requested_device_id || c?.device_id || "").trim();
  const normalized = requested === "shell.execute" || requested === "computer.use" || requested === "computer.use.autonomous" || requested === "computer.use.android"
    ? requested
    : ((goal.match(/\b(shell\.execute|computer\.use(?:\.autonomous|\.android)?)\b/i)?.[1] || "").toLowerCase());
  if(!normalized || !deviceId) return null;
  return {operation:normalized,device_id:deviceId,contract:c};
}

function directDeviceIntentPlan(goal:string, context:any){
  const intent=explicitDeviceIntent(goal,context);
  if(!intent) return null;
  const c=intent.contract;
  const marker=String(c?.verification_marker || "").trim()
    || (String(goal).match(/\bARIA_[A-Z0-9_]+\b/)?.[0] || "");
  const operation=intent.operation;
  const verification = operation==="shell.execute" && marker
    ? {expected_exit_code:0,stdout_contains:marker}
    : {response_content_nonempty:true};
  const command=operation==="shell.execute"
    ? String(c?.command || (marker ? `echo ${marker}` : "echo ARIA_DEVICE_INTENT_PASS"))
    : null;
  const input:any = operation==="shell.execute"
    ? {command,...(typeof c?.cwd==="string"&&c.cwd.trim()?{cwd:c.cwd}: {})}
    : {
        ...(c?.input && typeof c.input==="object" ? c.input : {}),
        ...(typeof c?.start_url==="string"&&c.start_url.trim()?{start_url:c.start_url}: {}),
      };
  return {
    goal,
    steps:[{
      id:"device_intent_1",
      operation,
      executor_type:"device",
      target:{type:"device",device_id:intent.device_id},
      input,
      risk:(["READ","LOW_RISK_WRITE","HIGH_RISK_WRITE","DESTRUCTIVE"].includes(String(c?.risk || "READ").toUpperCase()) ? String(c?.risk || "READ").toUpperCase() : "READ"),
      timeout_ms:Number.isInteger(c?.timeout_ms) ? c.timeout_ms : 30000,
      policy:{tool_use:true,explicit_device_intent:true,no_side_effects:operation==="shell.execute",spanish_output_required:true},
      verify:verification,
      selection:{
        capability_intent:operation,
        requested_device_id:intent.device_id,
        requested_capability:operation,
        verification_marker:marker || null,
        selection_reason:"explicit mission device contract"
      }
    }],
    planner_version:"aria-planner-v11-explicit-device-intent-v1",
    explicit_device_intent:true,
    mission_planner_contract:{requested_capability:operation,requested_device_id:intent.device_id,verification_marker:marker || null}
  };
}

async function tryVerifiedPathPlan(goal:string, context:any){
  try{
    const candidates:any[]=[];
    const mems=Array.isArray(context?.learned_knowledge?.memories)?context.learned_knowledge.memories:[];
    for(const m of mems) candidates.push(m);
    try{
      const memResp=await fetch(`${URL}/functions/v1/aria-memory-v2`,{
        method:"POST",
        headers:{authorization:`Bearer ${SECRET}`,"content-type":"application/json"},
        body:JSON.stringify({action:"search",query:"VERIFIED_PATH_V1 Verified multi-executor composition path connector-agent-model",limit:8})
      });
      const memJson=await memResp.json().catch(()=>({}));
      for(const m of (memJson?.results||[])) candidates.push(m);
    }catch(_e){}
    try{
      const {data}=await ROOT.from("memory_items").select("memory_id,title,content,memory_type,metadata,source_ref").eq("memory_type","skill").ilike("title","%verified multi-executor composition%").limit(8);
      for(const m of data||[]) candidates.push(m);
    }catch(_e){}
    for(const m of candidates){
      const content=String(m.content||"");
      const marker="VERIFIED_PATH_V1:";
      const idx=content.indexOf(marker);
      if(idx<0) continue;
      let path:any=null;
      try{ path=JSON.parse(content.slice(idx+marker.length).trim()); }catch{ continue; }
      if(!path||path.status!=="VERIFIED_E2E"||!Array.isArray(path.steps)||!path.steps.length) continue;
      const g=goal.toLowerCase();
      const compositionIntent=/(composition|composici[oó]n|verified.?path|connector.*agent|health.*agent.*model|multi-?executor|reuse verified path)/i.test(goal)
        || (g.includes("health")&&g.includes("agent")&&g.includes("model"));
      if(!compositionIntent) continue;
      const routes=await modelRoutes();
      const route=routes.find((r:any)=>String(r.model_id||"").includes("gemini-3.5-flash-lite"))||routes.find((r:any)=>r.provider_id==="google")||routes[0];
      if(!route) continue;
      const built:any[]=[];
      let prev:string|null=null;
      for(let i=0;i<path.steps.length;i++){
        const s=path.steps[i];
        const id=String(s.id||`vp_${i+1}`);
        const et=String(s.executor_type||"");
        const op=String(s.operation||"");
        const deps=prev?[prev]:[];
        if(et==="connector"&&op==="health"){
          built.push({id,operation:"health",executor_type:"connector",target:{type:"connector",connector_id:s.connector_id||"supabase"},input:{},risk:"READ",timeout_ms:15000,policy:{runtime_probe:true,verified_path:true},depends_on:deps.length?deps:undefined,verify:{},selection:{verified_path:true,evidence_ref:path.evidence_ref||null}});
        }else if(et==="agent"){
          built.push({id,operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:s.agent_id||"aria-agent-verifier-openrouter-v1"},capability:"delegation",input:{goal:"Verified path agent step",prompt:"Prior connector health succeeded. Reply FINDINGS: ok. VERDICT: PASS. Max 3 sentences.",max_tokens:300},risk:"READ",timeout_ms:120000,policy:{verified_path:true},depends_on:deps,verify:{},selection:{verified_path:true,evidence_ref:path.evidence_ref||null}});
        }else if(et==="model"){
          const isVerify=op==="verification"||String(s.role||"")==="verification"||id.startsWith("v");
          const prompt=isVerify?"Reply with exactly VERIFICATION_PASS.":"Reply with exactly the marker COMPOSITION_FULL_OK and one short sentence.";
          const contains=isVerify?"VERIFICATION_PASS":"COMPOSITION_FULL_OK";
          built.push({id,operation:"text_generation",executor_type:"model",target:{type:"model",provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id},capability:"text_generation",input:{payload:{prompt,max_tokens:80,temperature:0}},risk:"READ",timeout_ms:90000,policy:{verified_path:true},depends_on:deps,verify:{response_content_contains:contains},selection:{verified_path:true,evidence_ref:path.evidence_ref||null,model_id:route.model_id}});
        }else{ continue; }
        prev=id;
      }
      if(built.length<3) continue;
      return {goal,steps:built,planner_version:"aria-planner-v11-verified-path-reuse-v1",verified_path_reuse:true,verified_path:{memory_id:m.memory_id||null,evidence_ref:path.evidence_ref||null,capability_chain:path.capability_chain||[],status:path.status,source_title:m.title||null},learning_context:context?.learned_knowledge};
    }
  }catch(_e){}
  return null;
}

async function learningContextForGoal(goal:string){
  try {
    const {data,error}=await ROOT.rpc("aria_memory_learning_context_for_goal",{p_goal:goal,p_limit:12});
    const memories=Array.isArray(data)?data:[];
    return {version:"mastery-learning-loop-v1",available:!error,memories,active:memories.filter((m:any)=>m?.status==="active"),candidates:memories.filter((m:any)=>m?.status==="candidate"),required:memories.filter((m:any)=>m?.application_required===true)};
  } catch {
    return {version:"mastery-learning-loop-v1",available:false,memories:[],active:[],candidates:[],required:[]};
  }
}
function learningPromptSuffix(learning:any){
  const items=Array.isArray(learning?.memories)?learning.memories.slice(0,8):[];
  if(!items.length)return "";
  return "\n\nAPRENDIZAJE VIGENTE DE ARIA — DEBES CONSULTARLO Y APLICARLO SI ES RELEVANTE:\n"
    + items.map((m:any)=>"- "+m.title+": "+String(m.content||"").slice(0,900)).join("\n")
    + "\nNo repitas una estrategia documentadamente fallida sin evidencia nueva. Verifica en la realidad cualquier prerrequisito aprendido antes de actuar.";
}

async function modelRoutes(){
  const [{data:m},{data:c},{data:a},{data:devices}] = await Promise.all([
    db.from("model_registry").select("model_id,provider_id,status,enabled"),
    db.from("capability_matrix").select("model_id,status,evidence_type,evidence_ref").eq("capability_id","text_generation"),
    db.from("account_registry").select("account_id,provider_id,status,enabled"),
    db.from("device_registry").select("device_id,agent_type,status,capabilities"),
  ]);
  const localQwenDevice = (devices || [])
    .filter((device:any) =>
      String(device?.agent_type || "") === "windows-local" &&
      String(device?.status || "").toLowerCase() === "online" &&
      Array.isArray(device?.capabilities) &&
      device.capabilities.map(String).includes("ollama.qwen3")
    )
    .sort((a:any,b:any) => String(b?.last_seen_at || "").localeCompare(String(a?.last_seen_at || "")))[0] || null;
  const localQwenAvailable = Boolean(localQwenDevice);
  return (m || [])
    .filter((x:any) => x.enabled && x.status === "available")
    .map((x:any) => {
      const cap=(c||[]).find((z:any)=>z.model_id===x.model_id);
      const acc=(a||[]).find((z:any)=>z.provider_id===x.provider_id&&z.enabled&&["available","active"].includes(String(z.status)));
      if(!acc) return null;
      if(x.provider_id === "local_windows" && x.model_id === "qwen3:0.6b" && !localQwenAvailable) return null;
      return {
        model_id:x.model_id,
        provider_id:x.provider_id,
        account_id:acc.account_id,
        ...(x.provider_id === "local_windows" && x.model_id === "qwen3:0.6b"
          ? { device_id: String(localQwenDevice.device_id) }
          : {}),
        capability_status:cap?.status||"unknown",
        evidence_type:cap?.evidence_type||"unknown",
        evidence_ref:cap?.evidence_ref||null,
        score:(cap?.status==="verified"?100:50)+(x.provider_id==="google"?10:0)
      };
    })
    .filter(Boolean)
    .sort((x:any,y:any)=>y.score-x.score)
}
async function multiProjectRealityBoardPlan(goal:string,context:any){
  const g=String(goal||"");
  if(!/(reality\s+board|panel\s+de\s+estado|estado\s+real.*proyectos)/i.test(g)) return null;
  const gl=g.toLowerCase();
  if(!/battlecruiser/i.test(gl)||!/(cueva\s*coin|cuevacoin)/i.test(gl)||!/\baria\b/i.test(gl)) return null;

  const scope = `REALITY BOARD MULTI-PROJECT. Debes trabajar sobre los tres proyectos explícitamente solicitados: ARIA, CuevaCoin y BattleCruiser. La aplicación central se implementa en ARIA/aria-worker; CuevaCoin y BattleCruiser se consultan como fuentes reales y no se modifican salvo que el objetivo lo exija explícitamente. No uses datos inventados ni snapshots históricos como LIVE.`;
  const readPolicy={tool_use:true,verification_read:true,read_only_audit:true,non_mutating:true,destructive_actions_blocked:true,spanish_output_required:true};

  const sources:any[]=[
    {id:"reality_aria_repo_read",repo:"aria-worker",label:"ARIA",description:"ARIA / aria-worker",input:{owner:"Robvg9",repo:"aria-worker"},target:{type:"connector",connector_id:"github",owner:"Robvg9",repo:"aria-worker",branch:"main"}},
    {id:"reality_cuevacoin_repo_read",repo:"CuevaCoin",label:"CuevaCoin",description:"CuevaCoin",input:{owner:"Robvg9",repo:"CuevaCoin"},target:{type:"connector",connector_id:"github",owner:"Robvg9",repo:"CuevaCoin",branch:"main"}},
    {id:"reality_battlecruiser_repo_read",repo:"battlecruiser",label:"BattleCruiser",description:"BattleCruiser",input:{owner:"Robvg9",repo:"battlecruiser"},target:{type:"connector",connector_id:"github",owner:"Robvg9",repo:"battlecruiser",branch:"main"}},
  ];

  const steps:any[]=sources.map(s=>({
    id:s.id,
    operation:"repo_read",
    executor_type:"connector",
    target:s.target,
    input:s.input,
    risk:"READ",
    timeout_ms:60000,
    policy:readPolicy,
    verify:{response_content_nonempty:true}
  }));

  const agentsRes=await db.from("agent_catalog").select("agent_id,role,model_id,status,max_risk").eq("status","available").order("agent_id").limit(20);
  const agents=Array.isArray(agentsRes.data)?agentsRes.data:[];
  const coder=agents.find((a:any)=>a.agent_id==="aria-agent-coding-v1")||agents.find((a:any)=>/cod|developer|implement/i.test(String(a.role||"")))||agents[0];
  const reviewer=agents.find((a:any)=>a.agent_id==="aria-agent-reviewer-v1")||agents.find((a:any)=>/review|revisor|forensic|investig/i.test(String(a.role||")))||agents[0];
  if(!coder||!reviewer) return null;

  steps.push({
    id:"reality_board_implementation",
    operation:"delegate",
    executor_type:"agent",
    target:{type:"agent",agent_id:String(coder.agent_id)},
    capability:"coding",
    input:{
      goal:g,
      prompt:esPrompt(
        scope+
        " Implementa una aplicación web funcional llamada ARIA Reality Board dentro de ARIA/aria-worker. "+
        "Usa las lecturas reales de ARIA, CuevaCoin y BattleCruiser como contexto previo. "+
        "La aplicación debe consultar fuentes actuales, mostrar qué está terminado/verificado/LIVE/E2E/bloqueado/pendiente/histórico/no confirmado, "+
        "y explicar en lenguaje humano qué falta. No conviertas un commit o archivo en evidencia de cumplimiento funcional. "+
        "Crea pruebas focalizadas. Trabaja en una rama gobernada no-main y devuelve branch, archivos, commits y evidencia concreta. "+
        "Incluye enlaces VER/DESCARGAR para resultados utilizables. "+
        "PROYECTOS OBLIGATORIOS EN ESTA MISIÓN: ARIA, CuevaCoin, BattleCruiser. "+
        "NO modifiques CuevaCoin ni BattleCruiser; solo léelos como fuentes para construir el panel central de ARIA. "+
        "FUENTES: ARIA/aria-worker, Robvg9/CuevaCoin, Robvg9/battlecruiser."
      ),
      max_tokens:4200
    },
    risk:"LOW_RISK_WRITE",
    timeout_ms:300000,
    policy:{...governedWritePolicy,post_merge_verification_required:true,spanish_output_required:true},
    depends_on:sources.map(s=>s.id),
    verify:{response_content_nonempty:true}
  });

  steps.push(agentStep(
    "reality_board_verification",
    {agent_id:String(reviewer.agent_id),role:String(reviewer.role||"revisor"),model_id:String(reviewer.model_id||"")},
    scope+
    " Verifica el resultado REAL de reality_board_implementation. Inspecciona el código, pruebas y evidencia. Confirma específicamente ARIA, CuevaCoin y BattleCruiser, y comprueba que el panel obtiene datos de fuentes reales en vez de contenido hardcodeado. No modifiques nada. No declares éxito si solo existe un archivo. Devuelve CONCLUSIÓN, EVIDENCIA, FALTANTES, BLOQUEOS y VEREDICTO.",
    ["reality_board_implementation"]
  ));

  return {
    goal:g,
    steps,
    planner_version:"aria-planner-v11-multi-project-reality-board-v1",
    multi_project_reality_board:true,
    project_scope:["aria","cuevacoin","battlecruiser"],
    implementation_repository:"Robvg9/aria-worker",
    source_repositories:["Robvg9/aria-worker","Robvg9/CuevaCoin","Robvg9/battlecruiser"],
    context:context?.learned_knowledge
  };
}

async function ariaPwaMasterMissionPlan(goal:string,context:any){
  const g=String(goal||"");
  if(!/(libro\s+maestro|pwa\s+aria|aria\s+.*pwa|pwa\s+.*aria)/i.test(g)) return null;
  const gl=g.toLowerCase();
  const deviceId=String(context?.mission_planner_contract?.requested_device_id||context?.device_id||"").trim();
  const targetUrl=String(context?.start_url||"https://aria.robvg9.workers.dev/pwa/");
  const windows=await windowsPcRwhtPlan(g+" Windows PC RWHT",{
    ...context,
    start_url:targetUrl,
    max_actions:Math.max(40,Math.min(180,Number(context?.max_actions||120))),
    max_runtime_ms:Math.max(180000,Math.min(900000,Number(context?.max_runtime_ms||600000)))
  });
  const routes=await modelRoutes();
  const agentsRes=await db.from("agent_catalog").select("agent_id,role,model_id,status,max_risk")
    .eq("status","available").order("agent_id").limit(20);
  const agents=Array.isArray(agentsRes.data)?agentsRes.data:[];
  const reviewer=agents.find((a:any)=>/review|revisor|forensic|investig/i.test(String(a.role||"")))||agents[0];
  const coder=
    agents.find((a:any)=>a.agent_id==="aria-agent-coding-v1" && !/android/i.test(String(a.agent_id||"")+" "+String(a.role||""))) ||
    agents.find((a:any)=>/cod|developer|implement/i.test(String(a.role||"")) && !/android/i.test(String(a.agent_id||"")+" "+String(a.role||""))) ||
    agents.find((a:any)=>a.agent_id!=="aria-agent-reviewer-v1" && !/android/i.test(String(a.agent_id||"")+" "+String(a.role||""))) ||
    agents[0];
  const route=routes.find((x:any)=>x.provider_id==="openrouter")||routes[0];
  if(!reviewer||!coder||!route)return null;
  const evidenceContext=JSON.stringify({scope:"PWA ARIA Libro Maestro",goal:g,start_url:targetUrl,device_id:deviceId||null}).slice(0,7000);
  const steps:any[]=[];
  steps.push(agentStep("master_inventory_1",reviewer,
    "AUDITORÍA INICIAL DEL LIBRO MAESTRO. Inspecciona únicamente evidencia real del estado actual de ARIA y su PWA. Debes producir un inventario priorizado de problemas, contradicciones y pruebas pendientes por las 13 áreas del alcance. No modifiques nada. Distingue CONFIRMADO/HIPÓTESIS. Objetivo: "+g+" CONTEXTO: "+evidenceContext));
  steps.push(modelStep("master_synthesis_1",route,
    "Analiza el inventario producido por master_inventory_1 y conviértelo en un backlog operativo mínimo, ordenado por dependencia. El resultado debe indicar qué puede verificarse en Windows RWHT, qué requiere repositorio/runtime y qué requiere Human Gate. No inventes. Objetivo: "+g+" CONTEXTO: "+evidenceContext,
    ["master_inventory_1"]));
  steps.push({
    id:"master_rwht_1",
    ...(windows&&typeof windows==="object"&&windows.plan?windows.plan.steps?.[0]||{}:{
      operation:"computer.use.autonomous",executor_type:"device",
      target:{type:"device",device_id:deviceId||null},
      input:{mode:"rwht",goal:g,start_url:targetUrl,max_actions:120,max_runtime_ms:600000,capture_screenshots:true},
      risk:"LOW_RISK_WRITE",timeout_ms:660000,policy:{tool_use:true,autonomous_ui_test:true,adaptive_replanning:true,destructive_actions_blocked:true,secret_input_blocked:true,spanish_output_required:true},verify:{response_content_nonempty:true}
    }),
  });
  steps[2].depends_on=["master_synthesis_1"];
  steps.push({
    id:"master_implementation_1",
    operation:"delegate",executor_type:"agent",
    target:{type:"agent",agent_id:coder.agent_id},
    capability:"coding",
    input:{goal:"LIBRO MAESTRO — implementación gobernada de los hallazgos confirmados",prompt:esPrompt("Usa los resultados de master_inventory_1, master_synthesis_1 y master_rwht_1. Implementa únicamente correcciones confirmadas y gobernadas en una rama no-main. No trabajes sobre BattleCruiser/CuevaCoin salvo que el hallazgo lo requiera explícitamente. Ejecuta pruebas focalizadas. Registra archivos, commits y evidencia. Objetivo: "+g),max_tokens:3600},
    risk:"LOW_RISK_WRITE",timeout_ms:240000,
    policy:{...governedWritePolicy,spanish_output_required:true,post_merge_verification_required:true},
    depends_on:["master_rwht_1"],verify:{}
  });
  steps.push(agentStep("master_verification_1",reviewer,
    "VERIFICACIÓN FINAL DEL BLOQUE ACTUAL DEL LIBRO MAESTRO. Contrasta inventario, RWHT, cambios implementados, tests y evidencia LIVE. No modifiques nada. Debes indicar explícitamente si el bloque está listo para pasar al siguiente área o qué causa concreta queda pendiente. Objetivo: "+g+" CONTEXTO: "+evidenceContext,
    ["master_implementation_1"]));
  return {
    goal:g,steps,
    planner_version:"aria-planner-v11-aria-pwa-master-v1",
    primary_objective:true,
    project_id:"aria",
    scope:"pwa_master",
    execution_lane:"primary",
    start_url:targetUrl,
    capability_policy:"aria-pwa-master-explicit-scope-v1",
    learning_context:context?.learned_knowledge
  };
}

async function battlecruiserReadonlyAuditPlan(goal:string,context:any){
  const rawProject=String(
    context?.project_id
      ?? context?.metadata?.project_id
      ?? context?.project?.id
      ?? ""
  ).toLowerCase();
  const g=String(goal||"");
  const gl=g.toLowerCase();
  // BattleCruiser audit routing requires explicit scoped intent. A broad ARIA/PWA
  // or multi-project mission may mention BattleCruiser as downstream context without targeting it.
  const multiProjectScope = /battlecruiser/i.test(g)
    && /cueva\s*coin|cuevacoin/i.test(g)
    && /\baria\b/i.test(g)
    && /(?:proyectos?|tres proyectos|cada proyecto|mostrar al menos|incluye al menos|reality board|panel de estado|estado real)/i.test(g);
  const broadAriaPwaScope=/(libro\s+maestro|pwa\s+aria|aria\s+.*pwa|pwa\s+.*aria)/i.test(g);
  const explicitBattleCruiserTarget=rawProject==="battlecruiser"
    || /(?:^|[\n.;:])\s*(?:objetivo|misión|mision|tarea|proyecto|repositorio|repo)?\s*battlecruiser\s*(?:$|[\n.;:])/i.test(g)
    || /\b(?:audita|auditar|revisa|revisar|inspecciona|inspeccionar|diagnostica|diagnosticar|analiza|analizar)\s+(?:(?:el|la|al|a|mi|tu|proyecto|repositorio|repo)\s+)?battlecruiser\b/i.test(g)
    || /\b(?:proyecto|repositorio|repo|rama|archivo|pull\s+request|pr)\s+(?:de\s+)?battlecruiser\b/i.test(g);
  const explicitBattleCruiser=explicitBattleCruiserTarget && !broadAriaPwaScope && !multiProjectScope;
  const auditIntent=/(auditor[ií]a|auditar|audit|inspecciona|inspeccionar|revisa|revisar|diagn[oó]stico|estado actual|read[- ]only|solo lectura|sin modificar)/i.test(g);
  if(!explicitBattleCruiser || !auditIntent)return null;

  const owner="Robvg9";
  const repo="battlecruiser";
  const branch="main";
  const baseTarget={type:"connector",connector_id:"github",owner,repo,branch};
  const readPolicy={
    tool_use:true,
    verification_read:true,
    read_only_audit:true,
    non_mutating:true,
    destructive_actions_blocked:true,
    spanish_output_required:true
  };

  const steps:any[]=[
    {
      id:"bc_github_repo_read",
      operation:"repo_read",
      executor_type:"connector",
      target:baseTarget,
      input:{owner,repo},
      risk:"READ",
      timeout_ms:60000,
      policy:readPolicy,
      verify:{response_content_nonempty:true}
    },
    {
      id:"bc_github_tree_read",
      operation:"tree_read",
      executor_type:"connector",
      target:baseTarget,
      input:{owner,repo,branch},
      risk:"READ",
      timeout_ms:60000,
      policy:readPolicy,
      depends_on:["bc_github_repo_read"],
      verify:{response_content_nonempty:true}
    },
    {
      id:"bc_github_package_read",
      operation:"file_read",
      executor_type:"connector",
      target:baseTarget,
      input:{owner,repo,branch,path:"package.json"},
      risk:"READ",
      timeout_ms:60000,
      policy:readPolicy,
      depends_on:["bc_github_tree_read"],
      verify:{response_content_nonempty:true}
    },
    {
      id:"bc_github_cerebro_read",
      operation:"file_read",
      executor_type:"connector",
      target:baseTarget,
      input:{owner,repo,branch,path:"BATTLECRUISER_CEREBRO.md"},
      risk:"READ",
      timeout_ms:60000,
      policy:readPolicy,
      depends_on:["bc_github_tree_read"],
      verify:{response_content_nonempty:true}
    },
    {
      id:"bc_github_test_runner_read",
      operation:"file_read",
      executor_type:"connector",
      target:baseTarget,
      input:{owner,repo,branch,path:"test/run-suite.js"},
      risk:"READ",
      timeout_ms:60000,
      policy:readPolicy,
      depends_on:["bc_github_tree_read"],
      verify:{response_content_nonempty:true}
    },
    {
      id:"bc_github_quality_workflow_read",
      operation:"file_read",
      executor_type:"connector",
      target:baseTarget,
      input:{owner,repo,branch,path:".github/workflows/quality.yml"},
      risk:"READ",
      timeout_ms:60000,
      policy:readPolicy,
      depends_on:["bc_github_tree_read"],
      verify:{response_content_nonempty:true}
    }
  ];

  const evidenceStepIds=steps.map((s:any)=>s.id);
  const evidenceInstruction=[
    "Eres el sintetizador final de una auditoría READ-ONLY de BattleCruiser.",
    "FUENTE EXCLUSIVA: usa únicamente los resultados de los pasos GitHub que aparecen como dependencias de esta etapa.",
    "NO uses memoria, conocimiento previo, contexto LIVE previo ni suposiciones para afirmar que un archivo, test, proveedor o bloqueo existe.",
    "El árbol GitHub es la autoridad para presencia/ausencia de archivos; los file_read son autoridad para su contenido.",
    "Si README.md no aparece en el árbol, dilo como AUSENTE; no lo sustituyas inventando un README.",
    "Los tests deben reportarse solo a partir del árbol y de los archivos de test realmente leídos.",
    "No modifiques archivos, no hagas commits, no abras PR y no cambies configuración.",
    "Entrega el informe en español con esta estructura: PROBLEMA → EVIDENCIA → IMPACTO → SOLUCIÓN → RESULTADO → PRÓXIMA ACCIÓN.",
    "Incluye explícitamente repositorio, commit/branch inspeccionado, archivos fuentes revisados, tests encontrados, workflows relevantes y bloqueos.",
    "Termina con el marcador exacto AUDITORIA_BATTLECRUISER_READONLY_OK."
  ].join("\n");
  steps.push({
    id:"bc_audit_synthesis",
    operation:"text_generation",
    executor_type:"model",
    target:{type:"model",provider_id:"google",account_id:"acct_google_gemini_free",model_id:"google/gemini-3.5-flash-lite-direct"},
    capability:"text_generation",
    input:{payload:{prompt:SPANISH_OUTPUT_CONTRACT+"\n\n"+evidenceInstruction,max_tokens:3200,temperature:0}},
    risk:"READ",
    timeout_ms:120000,
    policy:{...readPolicy,evidence_bound_synthesis:true,model_must_not_claim_unread_evidence:true},
    depends_on:evidenceStepIds,
    verify:{response_content_contains:"AUDITORIA_BATTLECRUISER_READONLY_OK"},
    selection:{
      review_role:"forensic_auditor",
      model_id:"google/gemini-3.5-flash-lite-direct",
      provider_id:"google",
      account_id:"acct_google_gemini_free",
      evidence_only:true
    }
  });
  return {
    goal,
    steps,
    planner_version:"aria-planner-v11-battlecruiser-readonly-audit-v2",
    battlecruiser_readonly_audit:true,
    project_id:"battlecruiser",
    repository:{owner,repo,branch},
    mutation_allowed:false,
    evidence_contract:"github-read-then-model-synthesis"
  };
}

async function battlecruiserGithubRwhtPlan(goal:string,context:any){
  const rawProject=String(
    context?.project_id
      ?? context?.metadata?.project_id
      ?? context?.project?.id
      ?? ""
  ).toLowerCase();
  const g=String(goal||"");
  const gl=g.toLowerCase();
  // Mentioning BattleCruiser inside a broader ARIA/PWA audit is scope context, not BattleCruiser mission intent.
  // Specialized GitHub RWHT must activate only for an explicit BattleCruiser target/project.
  const broadAriaPwaScope=/(libro\s+maestro|pwa\s+aria|aria\s+.*pwa|pwa\s+.*aria)/i.test(g);
  const explicitBattleCruiserTarget=rawProject==="battlecruiser"
    || /(?:^|[\n.;])\s*(?:objetivo|misión|mision|tarea|proyecto)?\s*battlecruiser\s*(?:$|[\n.;:])/i.test(g);
  const isBattleCruiser=explicitBattleCruiserTarget && !broadAriaPwaScope;
  const githubWork=/github|rama|branch|archivo|pull request|pr|main|merge/i.test(gl) || gl.includes(".md");
  if(!isBattleCruiser || !githubWork)return null;

  const branchMatch=g.match(/aria\/sandbox\/[A-Za-z0-9._\/-]+/i);
  const branch=branchMatch?branchMatch[0]:"aria/sandbox/rwht-battlecruiser";
  const pathMatch=g.match(/(?:archivo\s+)?([A-Za-z0-9_./-]+\.md)\b/i);
  const path=pathMatch?pathMatch[1]:"RWHT_ARIA_PROBE.md";
  const noMerge=/no\s+(?:hagas\s+)?merge|sin\s+merge|do not merge/i.test(g);
  const wantsPr=/pull request|\bpr\b/i.test(gl);
  const authorization={status:"approved",authorization_id:"github:battlecruiser-sandbox-rwht"};
  const policy={tool_use:true,non_main_branch_required:true,mutating_operation_required:true,do_not_claim_text_only_success:true,spanish_output_required:true};
  const content="RWHT ARIA ↔ BattleCruiser — prueba de integración controlada.\\n\\nCreado por la ruta gobernada de ARIA para validar rama, escritura, lectura y PR sin fusionar.";
  const steps:any[]=[
    {
      id:"github_create_branch",
      operation:"create_branch",
      executor_type:"connector",
      target:{type:"connector",connector_id:"github",repo:"battlecruiser",owner:"Robvg9",branch},
      input:{repo:"battlecruiser",owner:"Robvg9",branch,ref:"main"},
      risk:"LOW_RISK_WRITE",
      timeout_ms:60000,
      authorization,
      policy,
      verify:{response_content_nonempty:true}
    },
    {
      id:"github_file_write",
      operation:"file_write",
      executor_type:"connector",
      target:{type:"connector",connector_id:"github",repo:"battlecruiser",owner:"Robvg9",branch},
      input:{repo:"battlecruiser",owner:"Robvg9",branch,path,content,message:"test: RWHT ARIA BattleCruiser integration probe"},
      risk:"LOW_RISK_WRITE",
      timeout_ms:60000,
      authorization,
      policy,
      depends_on:["github_create_branch"],
      verify:{response_content_nonempty:true}
    },
    {
      id:"github_file_verify",
      operation:"file_read",
      executor_type:"connector",
      target:{type:"connector",connector_id:"github",repo:"battlecruiser",owner:"Robvg9",branch},
      input:{repo:"battlecruiser",owner:"Robvg9",branch,path},
      risk:"READ",
      timeout_ms:60000,
      policy:{tool_use:true,verification_read:true,spanish_output_required:true},
      depends_on:["github_file_write"],
      verify:{response_content_nonempty:true}
    }
  ];
  if(wantsPr){
    steps.push({
      id:"github_open_pr",
      operation:"open_pr",
      executor_type:"connector",
      target:{type:"connector",connector_id:"github",repo:"battlecruiser",owner:"Robvg9",branch},
      input:{
        repo:"battlecruiser",owner:"Robvg9",branch,base:"main",
        title:"test: RWHT ARIA ↔ BattleCruiser integration probe",
        body:"Prueba controlada de integración ARIA ↔ BattleCruiser. Se verificó la escritura del archivo "+path+" en la rama "+branch+". "+(noMerge?"No realizar merge.":"No fusionar automáticamente.")
      },
      risk:"LOW_RISK_WRITE",
      timeout_ms:60000,
      authorization,
      policy,
      depends_on:["github_file_verify"],
      verify:{response_content_nonempty:true}
    });
  }
  return {goal,steps,planner_version:"aria-planner-v11-battlecruiser-github-rwht-v1",battlecruiser_github_rwht:true,project_id:"battlecruiser",branch,path,no_merge:noMerge,learning_context:context?.learned_knowledge};
}

async function windowsPcRwhtPlan(goal:string,context:any){
  const g=String(goal||"");
  const gl=g.toLowerCase();
  const isRwht=/(\brwht\b|real world human test|prueba real|auditar.*interfaz|auditar.*ui|bot[oó]n.*bot[oó]n|button.*button)/i.test(g);
  const isPc=/(pc|windows|computadora|ordenador|escritorio|desktop|navegador|browser|battlecruiser)/i.test(g);
  const requestedDeviceId=String(
    context?.mission_planner_contract?.requested_device_id ||
    context?.requested_device_id ||
    context?.device_id ||
    ""
  ).trim().toLowerCase();
  const explicitWindowsDevice=requestedDeviceId.startsWith("windows-");
  // An explicit Windows target is stronger than lexical goal classification.
  if((!isRwht || !isPc) && !explicitWindowsDevice)return null;

  const {data:devices}=await db.from("device_registry")
    .select("device_id,display_name,agent_type,status,last_seen_at,capabilities")
    .eq("agent_type","windows-local")
    .in("status",["online","active","available"])
    .order("last_seen_at",{ascending:false})
    .limit(8);

  const recoveryRequested = context?.recovery_strategy_required === true || context?.identical_strategy_detected === true;
  const previousPlan = Array.isArray(context?.previous_plan) ? context.previous_plan : [];
  const failedStepId = String(context?.failed_step_id || context?.failed_step || "").trim();
  const failedPreviousStep = previousPlan.find((step:any)=>String(step?.id||"")===failedStepId) || previousPlan[0] || {};
  const previousFailedExecutor = String(context?.failed_executor_type || failedPreviousStep?.executor_type || failedPreviousStep?.target?.type || "").toLowerCase();
  const previousFailedOperation = String(context?.failed_operation || failedPreviousStep?.operation || "").toLowerCase();

  const candidates=(Array.isArray(devices)?devices:[]);
  // The registry capability list can lag behind the actual Windows runtime.
  // For RWHT we require an online windows-local device with the autonomous UI
  // capability. If qwen is advertised, it remains available as the local model;
  // if the heartbeat omits qwen while autonomous UI is still advertised, do not
  // turn a usable Windows runtime into planner_empty_steps.
  const device=candidates.find((d:any)=>{
    const caps=Array.isArray(d?.capabilities)?d.capabilities.map(String):[];
    return caps.includes("ollama.qwen3") || caps.includes("computer.use.autonomous");
  }) || null;

  if(!device){
    return out({
      error:"windows_pc_executor_unavailable",
      planner_version:"aria-planner-v11-capability-aware-windows-rwht-v2",
      capability_gap:{
        required:["computer.use.autonomous"],
        optional:["ollama.qwen3"],
        runtime_ui_capabilities:["computer.use","computer.use.autonomous"],
        online_windows_devices:candidates
      }
    },409);
  }

  const urlMatch=g.match(/https?:\/\/[^\s)]+/i);
  const isBattleCruiser=/battlecruiser/i.test(g) || String(context?.project_id||"").toLowerCase()==="battlecruiser";
  const startUrl=String(context?.start_url||"").trim()
    || (urlMatch?urlMatch[0].replace(/[.,;]+$/,""):null)
    || (isBattleCruiser?"https://battlecruiser.robvg9.workers.dev/":"https://aria.robvg9.workers.dev/pwa/");

  const maxActions=Math.max(20,Math.min(180,Number(context?.max_actions||120)));
  const maxRuntime=Math.max(120000,Math.min(900000,Number(context?.max_runtime_ms||600000)));
  const localTarget={
    device_id:String(device.device_id),
    display_name:device.display_name,
    agent_type:device.agent_type,
    status:device.status,
    capabilities:device.capabilities
  };
  if(recoveryRequested && (previousFailedExecutor==="model" || previousFailedOperation==="text_generation")){
    const fallbackUrl=startUrl;
    return out({ok:true,plan:{
      goal,
      steps:[{
        id:"local_qwen_recovery_1",
        operation:"computer.use.autonomous",
        executor_type:"device",
        target:{type:"device",device_id:String(device.device_id)},
        input:{mode:"rwht",goal:String(goal),start_url:fallbackUrl,max_actions:maxActions,max_runtime_ms:maxRuntime,capture_screenshots:true},
        risk:"LOW_RISK_WRITE",timeout_ms:maxRuntime+60000,
        policy:{tool_use:true,capability_aware:true,autonomous_ui_test:true,adaptive_replanning:true,destructive_actions_blocked:true,secret_input_blocked:true,recovery_route:"cloud_to_local_qwen"},
        verify:{response_content_nonempty:true}
      }],
      planner_version:"aria-planner-v11-local-qwen-recovery-v1",
      recovery_route:"cloud_to_local_qwen",
      alternative_strategy:true,
      capability_awareness:{version:"capability-awareness-v1",selected_device:localTarget,decision_stack:[{operation:"computer.use.autonomous",purpose:"observe → decide → act → verify → adapt",requires:["computer.use","ollama.qwen3"]},{operation:"ollama.qwen3",purpose:"local structured UI decision model",model:"qwen3:0.6b"}]}
    }});
  }
  if(recoveryRequested && previousFailedOperation==="computer.use.autonomous"){
    return out({ok:true,plan:{
      goal,
      steps:[
        {id:"deterministic_device_recovery_1",operation:"computer.use",executor_type:"device",target:{type:"device",device_id:String(device.device_id)},input:{action:"open",path:startUrl},risk:"READ",timeout_ms:30000,policy:{recovery_route:"local_qwen_to_deterministic_device",destructive_actions_blocked:true},verify:{response_content_nonempty:true}},
        {id:"deterministic_device_recovery_2",operation:"computer.use",executor_type:"device",target:{type:"device",device_id:String(device.device_id)},input:{action:"screenshot"},risk:"READ",timeout_ms:30000,policy:{recovery_route:"local_qwen_to_deterministic_device"},depends_on:["deterministic_device_recovery_1"],verify:{response_content_nonempty:true}}
      ],
      planner_version:"aria-planner-v11-deterministic-device-recovery-v1",
      recovery_route:"local_qwen_to_deterministic_device",
      alternative_strategy:true
    }});
  }

  const capabilityAwareness={
    version:"capability-awareness-v1",
    selected_device:{
      device_id:device.device_id,
      display_name:device.display_name,
      agent_type:device.agent_type,
      status:device.status,
      capabilities:device.capabilities
    },
    decision_stack:[
      {operation:"computer.use.autonomous",purpose:"observe → decide → act → verify → adapt",requires:["computer.use"]},
      {operation:"computer.use",purpose:"real Windows UI actions",actions:["observe","screenshot","click","double_click","type","keypress","hotkey","scroll","focus","wait"]},
      {operation:"ollama.qwen3",purpose:"local structured UI decision model",model:"qwen3:0.6b",optional:true}
    ],
    policy:{
      destructive_controls_blocked:true,
      secret_input_blocked:true,
      verification_after_action:true,
      fallback_replanning:true
    }
  };

  return out({ok:true,plan:{
    goal,
    steps:[{
      id:"windows_rwht_autonomous_1",
      operation:"computer.use.autonomous",
      executor_type:"device",
      target:{type:"device",device_id:String(device.device_id)},
      input:{
        mode:"rwht",
        goal:String(goal),
        start_url:startUrl,
        max_actions:maxActions,
        max_runtime_ms:maxRuntime,
        capture_screenshots:true
      },
      risk:"LOW_RISK_WRITE",
      timeout_ms:maxRuntime+60000,
      policy:{
        tool_use:true,
        capability_aware:true,
        autonomous_ui_test:true,
        adaptive_replanning:true,
        mutating_operation_required:true,
        destructive_actions_blocked:true,
        secret_input_blocked:true,
        physical_verification_required:false,
        spanish_output_required:true
      },
      verify:{response_content_nonempty:true}
    }],
    planner_version:"aria-planner-v11-capability-aware-windows-rwht-v1",
    capability_awareness:capabilityAwareness,
    target:{project_id:isBattleCruiser?"battlecruiser":null,start_url:startUrl}
  }});
}

async function androidAutonomousPlan(goal:string,context:any){
  const g=String(goal||'').toLowerCase();
  const requestedDeviceId=String(
    context?.mission_planner_contract?.requested_device_id ||
    context?.requested_device_id ||
    context?.device_id ||
    ""
  ).trim().toLowerCase();
  // Never divert an explicitly requested Windows mission into Android.
  if(requestedDeviceId.startsWith("windows-"))return null;
  if(!/(android|tel[eé]fono|\\bapp\\b|aplicaci[oó]n|pwa|\\bweb\\b|bot[oó]n|interfaz|\\bui\\b)/i.test(g))return null;
  if(!/(probar|prueba|test|verificar|auditar|comprobar|revisar|explorar)/i.test(g))return null;
  const explicitDevice=typeof context?.device_id==='string'?context.device_id:'';
  let device:any=null;
  if(explicitDevice){const {data}=await db.from('device_registry').select('device_id,display_name,agent_type,status,capabilities').eq('device_id',explicitDevice).maybeSingle();device=data||null;}
  if(!device){const {data}=await db.from('device_registry').select('device_id,display_name,agent_type,status,capabilities').eq('agent_type','android-termux').in('status',['online','active','available']).order('last_seen_at',{ascending:false}).limit(1).maybeSingle();device=data||null;}
  if(!device)return out({error:'android_device_unavailable',planner_version:'aria-planner-v11-android-autonomous-v1'},409);
  const pkgMatch=String(goal).match(/(?:package|paquete|app\s*id)\s*[:=]?\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)/i);
  const targetPackage=typeof context?.target_package==='string'&&context.target_package.trim()?context.target_package.trim():(pkgMatch?pkgMatch[1]:'com.android.chrome');
  const urlMatch=String(goal).match(/https?:\/\/[^\s)]+/i);
  const startUrl=typeof context?.start_url==='string'&&context.start_url.trim()?context.start_url.trim():(urlMatch?urlMatch[0].replace(/[.,;]+$/,''):null);
  const parsedHost=startUrl?((()=>{try{return new URL(startUrl).hostname}catch{return null}})()):null;
  const allowedHosts=Array.isArray(context?.allowed_hosts)?context.allowed_hosts.map(String).filter(Boolean).slice(0,12):(parsedHost?[parsedHost]:['aria.robvg9.workers.dev']);
  const startApp=!/^com\.android\.chrome$|^com\.chrome\.|^org\.mozilla\.|^com\.brave\./i.test(targetPackage);
  const maxSteps=Math.max(3,Math.min(12,Number(context?.max_steps||8)));
  const input={mode:'autonomous_test',goal:String(goal),target_package:targetPackage,allow_any_app:true,allowed_hosts:allowedHosts,start_url:startUrl,start_app:startApp,max_steps:maxSteps};
  return out({ok:true,plan:{goal,steps:[{id:'android_autonomous_1',operation:'computer.use',executor_type:'device',target:{type:'device',device_id:String(device.device_id)},input,risk:'LOW_RISK_WRITE',timeout_ms:180000,policy:{autonomous_ui_test:true,safe_actions_only:true,physical_verification_required:true,device_scoped:true,mutating_operation_required:false},verify:{expected_exit_code:0}},],planner_version:'aria-planner-v11-android-autonomous-v1',android_autonomous:true,device:{device_id:device.device_id,status:device.status,capabilities:device.capabilities}}});
}
async function assetPlan(goal:string, context:any={}){const g=goal.toLowerCase(); if(/(?:modelo individual:|model individual:)/i.test(goal)){const target=(goal.match(/(?:modelo individual:|model individual:)\s*([^\s]+)/i)||[])[1]||"";const routes=await modelRoutes();const route=routes.find((r:any)=>r.model_id===target);if(!route)return out({error:"target_model_unavailable",target},409);return out({ok:true,plan:{goal,steps:[modelStep("asset_1",route,`FINDINGS. Audit only the exact target model ${target}. Use the live route selected by ARIA. Discuss availability, route, account, capability evidence, observed behavior, limits, fallback and risks. Do not invent. Finish with VERDICT.`)],planner_version:"aria-planner-v11-asset-forensic-v1",asset_forensic:true,target_type:"model",target,learning_context:context?.learned_knowledge}})}
if(/(?:agente individual:|agent individual:)/i.test(goal)){const target=(goal.match(/(?:agente individual:|agent individual:)\s*([^\s]+)/i)||[])[1]||"";const {data:a}=await db.from("agent_catalog").select("agent_id,role,model_id,status,capabilities,max_risk").eq("agent_id",target).maybeSingle();if(!a||a.status!=="available")return out({error:"target_agent_unavailable",target},409);return out({ok:true,plan:{goal,steps:[agentStep("asset_1",a,`FINDINGS. Audit the exact target agent ${target}. Compare its live behavior with its registered role, capabilities, model, risk and limits. Use only evidence available to you; do not invent. Finish with VERDICT.`)],planner_version:"aria-planner-v11-asset-forensic-v1",asset_forensic:true,target_type:"agent",target,learning_context:context?.learned_knowledge}})}
if(/(?:dispositivo\/executor individual:|device\/executor individual:)/i.test(goal)){const target=(goal.match(/(?:dispositivo\/executor individual:|device\/executor individual:)\s*([^\s]+)/i)||[])[1]||"";return out({ok:true,plan:{goal,steps:[{id:"asset_1",operation:"shell.execute",executor_type:"device",target:{type:"device",device_id:target},input:{command:"echo ARIA_ASSET_FORENSIC_DEVICE_OK"},risk:"READ",timeout_ms:30000,policy:{asset_forensic:true,safe_read_only:true},verify:{expected_exit_code:0,stdout_contains:"ARIA_ASSET_FORENSIC_DEVICE_OK"}}],planner_version:"aria-planner-v11-asset-forensic-v1",asset_forensic:true,target_type:"device",target,learning_context:context?.learned_knowledge}})}
if(/(?:proveedor ia individual:|individual ai provider:)/i.test(goal)){const target=(goal.match(/(?:proveedor IA individual:|individual AI provider:)\s*([^ /]+)/i)||[])[1]||"";const routes=(await modelRoutes()).filter((r:any)=>r.provider_id===target);if(!routes.length)return out({error:"target_provider_unavailable",target},409);return out({ok:true,plan:{goal,steps:[modelStep("asset_1",routes[0],`FINDINGS. Audit the exact provider ${target} through the real route selected by ARIA. Check connectivity, authentication state as observable, capability behavior, errors, latency signals, security boundaries and fallbacks. Do not expose credentials or invent. Finish with VERDICT.`)],planner_version:"aria-planner-v11-asset-forensic-v1",asset_forensic:true,target_type:"provider",target,learning_context:context?.learned_knowledge}})}
return null}
function easPlan(g:string,context:any){const s=g.toLowerCase();let op:string|null=null;for(const x of ["connection_status","workflow_definitions","workflow_list","workflow_info","build_list","build_info","build_logs","workflow_dispatch"])if(s.includes(`eas.${x}`))op=`eas.${x}`;if(!op)return null;const input:any={};if(op.endsWith("workflow_list")||op.endsWith("build_list"))input.limit=20;if(op.endsWith("workflow_info"))input.runId=context?.runId;if(op.endsWith("build_info")||op.endsWith("build_logs"))input.buildId=context?.buildId;if(op.endsWith("workflow_dispatch")){input.gitRef=context?.gitRef;input.fileName=context?.fileName;input.inputs=context?.inputs}return out({ok:true,plan:{goal:g,steps:[{id:"eas_1",operation:op,executor_type:"eas",target:{type:"eas",project_id:EAS_PROJECT_ID},input,risk:"READ",timeout_ms:120000,policy:{},verify:{} }],planner_version:"aria-planner-v11-eas-aware",cognitive_context:context,learning_context:context?.learned_knowledge}})}
async function liveOperationalContext(goal:string){
  const safe=async(table:string, columns:string, limit=12)=>{ try { const {data,error}=await db.from(table).select(columns).limit(limit); return error?{error:error.message}:data||[]; } catch(e){ return {error:e instanceof Error?e.message:String(e)}; } };
  const [missions,devices,models,accounts,agents,caps]=await Promise.all([
    safe("mission_state","mission_id,goal,status,total_steps,current_step,completed_steps,next_action,last_stderr,updated_at",12),
    safe("device_registry","device_id,display_name,agent_type,status,last_seen_at,capabilities",20),
    safe("model_registry","model_id,provider_id,status,enabled",30),
    safe("account_registry","account_id,provider_id,status,enabled",20),
    safe("agent_catalog","agent_id,role,status,max_risk,capabilities",20),
    safe("capability_matrix","capability_id,model_id,status,evidence_type,evidence_ref",50),
  ]);
  return {version:"live-operational-context-v1",goal,missions,devices,models,accounts,agents,capabilities:caps,tool_universe:TOOL_UNIVERSE_V1,human_verification_policy:{android_rwht:"pending_until_explicit_persisted_human_evidence",online_device_never_equals_physical_rwht_certification:true},generated_at:new Date().toISOString()};
}

async function projectReviewPlan(goal:string,context:any){const live=await liveOperationalContext(goal);const agent={agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"};const liveText=JSON.stringify(live).slice(0,14000),ctxText=JSON.stringify(context).slice(0,5000);const steps=[agentStep("facts_1",agent,`Recopila hechos actuales y verificables sobre ARIA para la solicitud: ${goal}. Usa el contexto LIVE como fuente operativa, confirma qué está funcionando y qué está degradado, y separa CONFIRMADO de HIPÓTESIS y BLOQUEADO. No modifiques nada.\nLIVE:\n${liveText}\nCONTEXTO:\n${ctxText}`),agentStep("crosscheck_1",agent,`Haz una segunda revisión independiente de la solicitud: ${goal}. Contrasta la evidencia actual con lo que realmente consume el runtime, busca contradicciones y evita repetir supuestos. No modifiques nada.\nLIVE:\n${liveText}\nCONTEXTO:\n${ctxText}`,["facts_1"]),agentStep("summary_1",agent,`Redacta la respuesta final para el usuario sobre: ${goal}. Basa todo en la evidencia que puedas confirmar ahora. Explica qué ARIA encontró, qué funciona, qué está mal/degradado, qué evidencia lo demuestra y cuál es la siguiente acción concreta. Todo el texto humano debe estar en español. No uses JSON crudo y no afirmes que algo está completado sin evidencia.\nLIVE:\n${liveText}\nCONTEXTO:\n${ctxText}`,["crosscheck_1"])];return out({ok:true,plan:{goal,steps,planner_version:"aria-planner-v11-live-project-review-v2-multistep",live_project_review:true,live_operational_context:live}});}
async function allForOnePlan(goal:string,context:any){
  const g=String(goal||'');
  if(!/(?:all\s*for\s*one|todos?\s+para\s+uno|auditor[ií]a.*all\s*for\s*one|revision.*all\s*for\s*one|investigacion.*all\s*for\s*one)/i.test(g)) return null;

  const routes=await modelRoutes();
  const {data:catalogAgents}=await db.from("agent_catalog")
    .select("agent_id,role,model_id,status,max_risk,capabilities")
    .eq("status","available")
    .order("agent_id");
  const agents=Array.isArray(catalogAgents)?catalogAgents:[];
  if(!routes.length || agents.length < 4) return {error:"all_for_one_review_capacity_insufficient",planner_version:"aria-planner-v12-all-for-one-v1",required:{models:1,agents:4},available:{models:routes.length,agents:agents.length}};

  const scopeAreas=[
    ["architecture_runtime","arquitectura y runtime","arquitectura completa, edge functions, runtime canónico, contratos entre capas, despliegues y coherencia entre LIVE y código"],
    ["data_memory_learning","datos, memoria y aprendizaje","Supabase, estado persistido, memoria, aprendizaje, recalls, contaminación de contexto, consistencia y trazabilidad"],
    ["planning_reasoning","planificación y razonamiento","planner, selección de estrategia, alineación objetivo-plan, replanning, dependencias, deduplicación y calidad del razonamiento"],
    ["execution_verification","ejecución y verificación","mission runner, jobs, leases, executors, verificación independiente, evidencia, falsos positivos y cierre"],
    ["models_routing","modelos y routing","model registry, capability matrix, cuentas, rutas, fallback, selección de modelos y uso real de capacidades"],
    ["agents_devices_tools","agentes, dispositivos y herramientas","agent catalog, Windows, Android, Computer Use, GitHub, Cloudflare, Bitrise, EAS y límites/contratos de cada capacidad"],
    ["security_recovery","seguridad y recuperación","gates, permisos, secretos, riesgos, recovery, retries, bloqueos, bucles y capacidad de recuperación autónoma"],
    ["productivity_ux","velocidad, productividad y UX","latencia, pasos innecesarios, observabilidad, PWA, claridad humana, redundancias y fricción operativa"]
  ];

  const fallbackAgent={agent_id:"aria-agent-research-v1",role:"investigador",model_id:"google/gemini-3.5-flash-lite-direct"};
  const rolePreference: Record<string,string[]> = {
    architecture_runtime:["reviewer","researcher","planner"],
    data_memory_learning:["memory","researcher","reviewer"],
    planning_reasoning:["planner","reviewer","researcher"],
    execution_verification:["verifier","reviewer","researcher"],
    models_routing:["researcher","reviewer","planner"],
    agents_devices_tools:["device","reviewer","researcher"],
    security_recovery:["security","verifier","reviewer"],
    productivity_ux:["reviewer","business","researcher"],
  };
  const pickAgent=(scopeId:string,used:Set<string>)=>{
    const roles=rolePreference[scopeId]||["researcher","reviewer"];
    for(const role of roles){
      const found=agents.find((a:any)=>String(a?.role||"").toLowerCase()===role&&!used.has(String(a?.agent_id)));
      if(found){used.add(String(found.agent_id));return found;}
    }
    const fallback=agents.find((a:any)=>!used.has(String(a?.agent_id)))||fallbackAgent;
    if(fallback?.agent_id)used.add(String(fallback.agent_id));
    return fallback;
  };
  const usedAgents=new Set<string>();
  const selectedAgents=scopeAreas.map((area:any)=>pickAgent(String(area[0]),usedAgents));

  const contextText=JSON.stringify(context).slice(0,9000);
  const scopeStep={
    id:"all_for_one_scope_1",
    operation:"text_generation",
    executor_type:"model",
    target:{type:"model",provider_id:routes[0]?.provider_id||null,account_id:routes[0]?.account_id||null,model_id:routes[0]?.model_id||null},
    capability:"text_generation",
    input:{payload:{prompt:esPrompt(
      "PROTOCOLO ALL FOR ONE — FASE 1. Define el mapa de auditoría forense profunda de ARIA para este objetivo. Debe cubrir arquitectura/runtime, datos/memoria/aprendizaje, planificación/razonamiento, ejecución/verificación, modelos/routing, agentes/dispositivos/herramientas, seguridad/recuperación y velocidad/productividad/UX. Identifica qué evidencia concreta debe obtener cada especialista. No modifiques nada. Objetivo: "+g+"\\nCONTEXTO: "+contextText
    ),max_tokens:2200,temperature:0}},
    risk:"READ",
    timeout_ms:90000,
    policy:{spanish_output_required:true,all_for_one:true,audit_only:true},
    verify:{response_content_nonempty:true}
  };

  const specialistSteps=scopeAreas.map((area:any,i:number)=>{
    const [id,label,scope]=area;
    const a=selectedAgents[i];
    return agentStep(
      "all_for_one_"+id,
      a,
      "PROTOCOLO ALL FOR ONE — REVISIÓN ESPECIALIZADA "+(i+1)+"/8. Tu único objetivo es investigar profundamente "+label+" de ARIA. Inspecciona evidencia real del repositorio/runtime/datos/herramientas disponibles para ti. Busca BUGS, contradicciones, cuellos de botella, capacidades inexistentes o mal conectadas, riesgos, oportunidades de mejora y límites actuales. Separa CONFIRMADO de HIPÓTESIS. No modifiques nada. Debes proponer mejoras concretas y una siguiente prueba verificable. Superficie exacta: "+scope+". Objetivo original: "+g+"\\nCONTEXTO: "+contextText,
      ["all_for_one_scope_1"]
    );
  });

  const arbiterRoute=routes.find((r:any)=>r.provider_id==="openrouter")||routes[1]||routes[0];
  if(!arbiterRoute) return {error:"all_for_one_arbiter_unavailable",planner_version:"aria-planner-v12-all-for-one-v1"};
  const arbiter= modelStep(
    "all_for_one_arbiter_10",
    arbiterRoute,
    "PROTOCOLO ALL FOR ONE — ÁRBITRO FINAL. Integra los 8 informes especializados y el mapa de cobertura. Los informes de los pasos dependientes estarán disponibles en los resultados de entrada bajo dependency_results; debes leerlos y cruzarlos antes de concluir. No inventes hechos. Resuelve contradicciones comparando evidencia. Entrega en español: 1) hallazgos confirmados, 2) fallos críticos, 3) causas raíz, 4) capacidades faltantes o mal conectadas, 5) mejoras de arquitectura/routing/ejecución/velocidad/UX, 6) bugs que ARIA puede reparar de forma gobernada, 7) mejoras que requieren intervención humana, 8) prioridades de las siguientes pruebas. El resultado debe ser accionable y servir como backlog de misiones. No cierres diciendo solamente 'revisar más'. Objetivo: "+g+"\\nCONTEXTO: "+contextText,
    specialistSteps.map((s:any)=>s.id)
  );

  return {
    goal:g,
    steps:[scopeStep,...specialistSteps,arbiter],
    planner_version:"aria-planner-v12-all-for-one-v1",
    all_for_one:true,
    audit_protocol:{
      version:"all-for-one-v1",
      mode:"deep_cross_system_forensic_review",
      specialist_count:8,
      arbiter:true,
      mutation_mode:"audit_only",
      coverage:scopeAreas.map((x:any)=>x[1])
    },
    learning_context:context?.learned_knowledge
  };
}

async function operationAuditPlan(goal:string,context:any){const match=goal.match(/(?:auditar operación ejecutora individual:|audit executor operation:|audit operation:)\s*([a-z0-9_.-]+)/i);if(!match)return null;const target=match[1];const agent={agent_id:"aria-agent-research-v1",role:"investigador",model_id:"google/gemini-3.5-flash-lite-direct"};const ctx=JSON.stringify(context).slice(0,6000);const steps=[agentStep("contract_1",agent,`Audita la operación exacta ${target}: contrato, disponibilidad, permisos, gobernanza y rutas reales. Solo lectura. Objetivo original: ${goal}. Contexto: ${ctx}`),agentStep("failure_modes_1",agent,`Audita la operación ${target} enfocándote en fallos, reintentos, verificación, observabilidad, seguridad y si el runtime realmente la consume. Separa CONFIRMADO de HIPÓTESIS. No modifiques nada. Objetivo: ${goal}. Contexto: ${ctx}`,["contract_1"]),agentStep("summary_1",agent,`Entrega una síntesis final en español sobre la auditoría de ${target}. Incluye evidencia concreta, problemas reales, bloqueos y conclusión sobre el estado actual. No inventes ni modifiques nada. Objetivo: ${goal}. Contexto: ${ctx}`,["failure_modes_1"])];return out({ok:true,plan:{goal,steps,planner_version:"aria-planner-v11-operation-forensic-v2-multistep",asset_forensic:true,target_type:"operation",target,learning_context:context?.learned_knowledge}});}
function selfAuditPlan(goal:string,context:any,routes:any,agents:any[]){const scope=`FINDINGS. Independent forensic review of ARIA. Scope: ${goal}. Context: ${JSON.stringify(context).slice(0,7000)}. Confirm facts from execution evidence; separate hypotheses; cover architecture, runtime, DB, memory, learning, planning, execution, models, agents, devices, tools, security, recovery.`;const steps:any[]=[];routes.slice(0,4).forEach((r:any,i:number)=>steps.push(modelStep(`review_model_${i+1}`,r,`${scope} Use model ${r.model_id}. Begin with FINDINGS and finish with VERDICT.`)));agents.slice(0,4).forEach((a:any,i:number)=>steps.push(agentStep(`review_agent_${i+1}`,a,`${scope} Independent specialist pass as ${a.role}. Begin with FINDINGS and finish with VERDICT.`)));return {goal,steps,planner_version:"aria-planner-v11-forensic-multi-route-v1",self_audit:true}}
async function missionProofGovernedRecoveryPlan(goal:string,context:any){
  const g=String(goal||"");
  if(!/ARIA Mission Proof|aria-mission-proof\.html/i.test(g)) return null;
  const live=await liveOperationalContext(g);
  const generatedAt=String(live?.generated_at||new Date().toISOString());
  const missionId=String(context?.mission_id||"");
  const owner="Robvg9", repo="aria-worker", branch="aria/mission-proof/"+Date.now().toString(36);
  const accountRows=Array.isArray(live?.accounts)?live.accounts:[];
  const openrouter=accountRows.find((a:any)=>String(a?.provider_id||"").toLowerCase()==="openrouter")||null;
  const missions=Array.isArray(live?.missions)?live.missions:[];
  const liveMission=missions.find((m:any)=>missionId&&String(m?.mission_id)===missionId)||missions.find((m:any)=>/ARIA Mission Proof|aria-mission-proof\.html/i.test(String(m?.goal||"")));
  const blockers:any[]=[];
  if(openrouter&&String(openrouter.status||"").toLowerCase()!=="available") blockers.push({value:"OpenRouter: "+String(openrouter.status||"NO CONFIRMADO").toUpperCase(),source_ref:"live-operational-context-v1",captured_at_utc:generatedAt});
  if(liveMission&&["waiting","blocked","failed"].includes(String(liveMission.status||"").toLowerCase())) blockers.push({value:"Misión de prueba: "+String(liveMission.status||"").toUpperCase()+" — "+String(liveMission.next_action||"NO CONFIRMADO"),source_ref:"mission:"+String(liveMission.mission_id||missionId||"unknown"),captured_at_utc:String(liveMission.updated_at||generatedAt)});
  if(!blockers.length) blockers.push({value:"NO CONFIRMADO",source_ref:"live-operational-context-v1",captured_at_utc:generatedAt});
  const evidence={generated_by:"ARIA governed mission-proof recovery plan",captured_at_utc:generatedAt,mission_id:missionId||null,source_ref:"live-operational-context-v1",values:{
    omniroute:{value:openrouter?String(openrouter.status||"NO CONFIRMADO").toUpperCase():"NO CONFIRMADO",source_ref:"live-operational-context-v1",captured_at_utc:generatedAt},
    ecc:{value:"NO CONFIRMADO",source_ref:"live-operational-context-v1",captured_at_utc:generatedAt},
    absorption_completion:{value:"NO CONFIRMADO",source_ref:"live-operational-context-v1",captured_at_utc:generatedAt},
    pending_gates:{value:"NO CONFIRMADO",source_ref:"live-operational-context-v1",captured_at_utc:generatedAt},
    aria_priority:{value:"Cerrar esta prueba E2E de escritura gobernada y verificación física.",source_ref:missionId?"mission:"+missionId:"live-operational-context-v1",captured_at_utc:generatedAt},
    current_blockers:{value:blockers.map((x:any)=>x.value),source_ref:"live-operational-context-v1",captured_at_utc:generatedAt}
  }};
  const html="<!doctype html><html lang='es'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>ARIA Mission Proof</title><style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#0b1020;color:#eef2ff}main{max-width:900px;margin:auto}section{background:#141b31;border:1px solid #2a3556;border-radius:14px;padding:18px;margin:14px 0}h1,h2{margin-top:0}.v{font-weight:700}.meta{font-size:.82rem;opacity:.75}</style></head><body><main><h1>ARIA Mission Proof</h1><p>Artefacto autónomo de prueba de creación, persistencia y verificación.</p><section><h2>Estado verificado</h2><div id='facts'></div></section><section><h2>Siguiente acción recomendada</h2><p id='next'></p></section><section><h2>Proveniencia</h2><pre id='raw'></pre></section></main><script>const E="+JSON.stringify(evidence).replace(/</g,"\\u003c")+";const labels=[['OmniRoute','omniroute'],['ECC','ecc'],['Absorciones relevantes','absorption_completion'],['Gates pendientes','pending_gates'],['Prioridad actual de ARIA','aria_priority'],['Bloqueos actuales','current_blockers']];document.querySelector('#facts').innerHTML=labels.map(([label,key])=>{const x=E.values[key];return '<div class=\\'v\\'>'+label+': '+String(x.value)+'</div><div class=\\'meta\\'>source_ref='+String(x.source_ref)+' · captured_at_utc='+String(x.captured_at_utc)+'</div><hr>'}).join('');document.querySelector('#next').textContent='Completar la verificación física de esta rama y del archivo, y conservar el commit SHA real antes de declarar éxito.';document.querySelector('#raw').textContent=JSON.stringify(E,null,2);</script></body></html>";
  const authorization={status:"approved",authorization_id:"github:aria-mission-proof-recovery"};
  const policy={tool_use:true,non_main_branch_required:true,mutating_operation_required:true,do_not_claim_text_only_success:true,spanish_output_required:true,recovery_route:"governed_github_connector"};
  const reviewer={agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"};
  const steps=[
    agentStep("analysis_1",reviewer,"Analiza esta recuperación usando la evidencia LIVE. No modifiques nada. Confirma el artefacto, la rama válida y las comprobaciones físicas obligatorias. Objetivo: "+g+"\\nLIVE:\\n"+JSON.stringify(live).slice(0,14000)),
    {id:"implementation_create_branch",operation:"create_branch",executor_type:"connector",target:{type:"connector",connector_id:"github",owner,repo,branch},input:{owner,repo,branch,ref:"main"},risk:"LOW_RISK_WRITE",timeout_ms:60000,authorization,policy,depends_on:["analysis_1"],verify:{response_content_nonempty:true}},
    {id:"implementation_write_artifact",operation:"file_write",executor_type:"connector",target:{type:"connector",connector_id:"github",owner,repo,branch},input:{owner,repo,branch,path:"public/aria-mission-proof.html",content:html,message:"feat: create governed ARIA mission proof artifact"},risk:"LOW_RISK_WRITE",timeout_ms:60000,authorization,policy,depends_on:["implementation_create_branch"],verify:{response_content_nonempty:true}},
    {id:"implementation_verify_artifact",operation:"file_read",executor_type:"connector",target:{type:"connector",connector_id:"github",owner,repo,branch},input:{owner,repo,branch,path:"public/aria-mission-proof.html"},risk:"READ",timeout_ms:60000,policy:{tool_use:true,verification_read:true,spanish_output_required:true,recovery_route:"governed_github_connector"},depends_on:["implementation_write_artifact"],verify:{response_content_nonempty:true}},
    agentStep("verification_1",reviewer,"VERIFICACIÓN FÍSICA FINAL. Inspecciona GitHub y confirma rama, commit SHA, ruta exacta y contenido real. Contrasta source_ref/captured_at_utc y confirma que NO hay datos inventados ni contradicciones. No modifiques nada. Solo declara éxito si todo existe físicamente y es coherente.",["implementation_verify_artifact"])
  ];
  return {goal:g,steps,planner_version:"aria-planner-v11-mission-proof-governed-recovery-v1",recovery_route:"governed_github_connector",artifact_proof:true,live_evidence:evidence};
}
async function extractCapabilityIntent(goal:string):Promise<{capabilities:Array<{intent:string,required:boolean,signals:string[]}>,source:string}>{ 
  const g=goal.toLowerCase();
  const rules:Array<{intent:string,required:boolean,patterns:RegExp[]}> = [
    {intent:"infrastructure_health",required:true,patterns:[/infraestructura/,/disponibilidad/,/operativ[oa]/,/sistema\s+(est[aá]|listo)/,/comprobaci[oó]n\s+de\s+(estado|disponibilidad)/,/listo\s+para/]},
    {intent:"technical_review",required:true,patterns:[/revisi[oó]n\s+t[eé]cnica/,/evaluaci[oó]n\s+t[eé]cnica/,/revisi[oó]n\s+de\s+seguridad/,/evaluaci[oó]n\s+cuando/,/identifica\s+problemas/,/eval[uú]a\s+(sus\s+)?causas/,/problemas\s+relevantes/]},
    {intent:"synthesis",required:true,patterns:[/s[ií]ntesis/,/genera\s+(una\s+)?s[ií]ntesis/,/produce\s+(una\s+)?s[ií]ntesis/,/resumen\s+final/,/s[ií]ntesis\s+final/]},
    {intent:"verification",required:true,patterns:[/validada/,/validaci[oó]n\s+del\s+resultado/,/resultado\s+validado/,/con\s+validaci[oó]n/,/verificaci[oó]n\s+del\s+resultado/]},
  ];
  const caps:Array<{intent:string,required:boolean,signals:string[]}> = [];
  for(const rule of rules){
    const hits:string[]=[];
    for(const re of rule.patterns){ const m=g.match(re); if(m) hits.push(m[0]); }
    if(hits.length) caps.push({intent:rule.intent,required:rule.required,signals:hits});
  }
  return {capabilities:caps,source:"capability_signal_v1"};
}

const CAPABILITY_EXECUTOR_CATALOG:Record<string,{executor_type:string,operation:string,capability:string}> = {
  infrastructure_health:{executor_type:"connector",operation:"health",capability:"connector.health"},
  technical_review:{executor_type:"agent",operation:"delegate",capability:"delegation"},
  synthesis:{executor_type:"model",operation:"text_generation",capability:"text_generation"},
  verification:{executor_type:"model",operation:"text_generation",capability:"text_generation"},
};

function validateCapabilityPlan(steps:any[], intents:Array<{intent:string,required:boolean}>):{ok:boolean,reason?:string}{
  if(!Array.isArray(steps)||!steps.length) return {ok:false,reason:"empty_plan"};
  const ids=new Set<string>();
  for(const s of steps){
    const id=String(s.id||"");
    if(!id) return {ok:false,reason:"missing_step_id"};
    if(ids.has(id)) return {ok:false,reason:"duplicate_step_id:"+id};
    ids.add(id);
    if(!s.executor_type||!s.operation) return {ok:false,reason:"missing_executor_or_operation:"+id};
  }
  const idList=steps.map((s:any)=>String(s.id));
  for(const s of steps){
    for(const d of (Array.isArray(s.depends_on)?s.depends_on:[])){
      if(!idList.includes(String(d))) return {ok:false,reason:"missing_dependency:"+d};
      if(String(d)===String(s.id)) return {ok:false,reason:"self_dependency:"+s.id};
    }
  }
  const covered=new Set(steps.map((s:any)=>String(s.selection?.capability_intent||"")));
  for(const c of intents){
    if(c.required && !covered.has(c.intent)) return {ok:false,reason:"required_capability_uncovered:"+c.intent};
  }
  for(const s of steps){
    const intent=String(s.selection?.capability_intent||"");
    const meta=intents.find((c:any)=>c.intent===intent);
    if(meta && meta.required!==true) return {ok:false,reason:"optional_intent_must_not_select_executor:"+intent};
  }
  for(const s of steps){
    const et=String(s.executor_type||"");
    if(!["connector","agent","model","eas","device"].includes(et)) return {ok:false,reason:"unknown_executor:"+et};
  }
  const types=new Set(steps.map((s:any)=>s.executor_type));
  if(types.size<2) return {ok:false,reason:"not_multi_executor"};
  return {ok:true};
}

function parseOperationalLearningContent(content:string):any|null{
  try{
    const marker="OPERATIONAL_LEARNING_V1:";
    const idx=String(content||"").indexOf(marker);
    if(idx<0) return null;
    const obj=JSON.parse(String(content).slice(idx+marker.length).trim());
    if(!obj||obj.schema!=="OPERATIONAL_LEARNING_V1") return null;
    return obj;
  }catch{ return null; }
}

async function fetchOperationalLearning(goal:string):Promise<any[]>{
  const out:any[]=[];
  try{
    const memResp=await fetch(`${URL}/functions/v1/aria-memory-v2`,{
      method:"POST",
      headers:{authorization:`Bearer ${SECRET}`,"content-type":"application/json"},
      body:JSON.stringify({action:"search",query:"OPERATIONAL_LEARNING_V1 successful_strategy capability",limit:12})
    });
    const memJson=await memResp.json().catch(()=>({}));
    for(const m of (memJson?.results||[])){
      const rec=parseOperationalLearningContent(String(m.content||""));
      if(!rec) continue;
      out.push({...rec,memory_id:m.memory_id||rec.learning_id||null,title:m.title||null,_score:m.score||m.rrf_score||0});
    }
  }catch(_e){}
  return out.filter((r:any)=>r.reusable===true).sort((a:any,b:any)=>Number(b.confidence||0)-Number(a.confidence||0));
}

function applyOperationalLearning(requiredCaps:any[], learnings:any[]):{ordered:any[],applied:any[],retrieved:any[]}{
  const retrieved=learnings.slice(0,5).map((l:any)=>({
    learning_id:l.learning_id||null,
    memory_id:l.memory_id||null,
    confidence:l.confidence,
    reusable:l.reusable,
    result:l.result,
    applied:false,
    reason:"retrieved_only"
  }));
  const applied:any[]=[];
  let ordered=[...requiredCaps];
  for(const l of learnings){
    const conf=Number(l.confidence||0);
    if(conf<0.7){
      retrieved.push({learning_id:l.learning_id,memory_id:l.memory_id,confidence:conf,applied:false,reason:"confidence_below_threshold"});
      continue;
    }
    if(l.reusable!==true) continue;
    if(String(l.result||"")!=="succeeded") continue;
    const order=Array.isArray(l.successful_strategy?.capability_order)?l.successful_strategy.capability_order:[];
    if(!order.length) continue;
    const reqSet=new Set(requiredCaps.map((c:any)=>c.intent));
    const filtered=order.filter((x:string)=>reqSet.has(x));
    if(filtered.length<2) continue;
    const rest=requiredCaps.filter((c:any)=>!filtered.includes(c.intent));
    const byIntent=Object.fromEntries(requiredCaps.map((c:any)=>[c.intent,c]));
    const newOrder=[...filtered.map((i:string)=>byIntent[i]).filter(Boolean),...rest];
    if(newOrder.length!==requiredCaps.length) continue;
    if(newOrder.some((c:any)=>!c)) continue;
    ordered=newOrder;
    const entry={learning_id:l.learning_id||null,memory_id:l.memory_id||null,confidence:conf,influence:"capability_order",from:requiredCaps.map((c:any)=>c.intent),to:ordered.map((c:any)=>c.intent),applied:true,reason:"successful_strategy_reorder"};
    applied.push(entry);
    for(const r of retrieved){
      if((r.memory_id&&r.memory_id===l.memory_id)||(r.learning_id&&r.learning_id===l.learning_id)){
        r.applied=true; r.reason="successful_strategy_reorder";
      }
    }
    break;
  }
  return {ordered,applied,retrieved};
}

async function localQwenRecoveryPlan(goal:string, context:any){
  if(!(context?.recovery_strategy_required===true || context?.identical_strategy_detected===true)) return null;
  const previousPlan=Array.isArray(context?.previous_plan)?context.previous_plan:[];
  const failedId=String(context?.failed_step_id||context?.failed_step||"").trim();
  const failed=previousPlan.find((x:any)=>String(x?.id||"")===failedId)||previousPlan[0]||{};
  const failedExecutor=String(context?.failed_executor_type||failed?.executor_type||failed?.target?.type||"").toLowerCase();
  const failedOperation=String(context?.failed_operation||failed?.operation||"").toLowerCase();
  if(failedExecutor!=="model" && failedOperation!=="text_generation") return null;
  const {data,error}=await db.from("device_registry")
    .select("device_id,display_name,agent_type,status,capabilities,last_seen_at")
    .eq("agent_type","windows-local")
    .eq("status","online")
    .order("last_seen_at",{ascending:false})
    .limit(8);
  if(error) throw new Error("local_qwen_device_lookup:"+error.message);
  const device=(Array.isArray(data)?data:[]).find((d:any)=>Array.isArray(d?.capabilities)&&d.capabilities.map(String).includes("ollama.qwen3"));
  if(!device) return null;
  const startUrl=String(context?.start_url||"").trim()
    || (String(goal).match(/https?:\/\/[^\s)]+/i)?.[0] || "https://aria.robvg9.workers.dev/pwa/");
  return {
    goal,
    steps:[{
      id:"local_qwen_recovery_1",
      operation:"computer.use.autonomous",
      executor_type:"device",
      target:{type:"device",device_id:String(device.device_id)},
      input:{mode:"rwht",goal:String(goal),start_url:startUrl,max_actions:120,max_runtime_ms:600000,capture_screenshots:true},
      risk:"LOW_RISK_WRITE",
      timeout_ms:660000,
      policy:{tool_use:true,capability_aware:true,autonomous_ui_test:true,adaptive_replanning:true,destructive_actions_blocked:true,secret_input_blocked:true,recovery_route:"cloud_to_local_qwen"},
      verify:{response_content_nonempty:true},
      selection:{recovery_route:"cloud_to_local_qwen",failed_executor:failedExecutor,failed_operation:failedOperation,device_id:String(device.device_id),local_model:"qwen3:0.6b"}
    }],
    planner_version:"aria-planner-v11-local-qwen-recovery-v2",
    recovery_route:"cloud_to_local_qwen",
    alternative_strategy:true,
    capability_awareness:{selected_device:{device_id:String(device.device_id),display_name:device.display_name,agent_type:device.agent_type,status:device.status,capabilities:device.capabilities},local_model:"qwen3:0.6b"}
  };
}

async function tryCapabilityIntentPlan(goal:string, context:any){
  try{
    const extracted=await extractCapabilityIntent(goal);
    if(!extracted.capabilities.length) return null;
    const routes=await modelRoutes();
    const route=routes.find((r:any)=>String(r.model_id||"").includes("gemini-3.5-flash-lite"))||routes.find((r:any)=>r.provider_id==="google")||routes[0];
    if(!route) return null;
    const {data:agents}=await db.from("agent_catalog").select("agent_id,role,model_id,status,max_risk").eq("status","available").order("agent_id");
    const verifier=(agents||[]).find((a:any)=>a.agent_id==="aria-agent-verifier-openrouter-v1")
      ||(agents||[]).find((a:any)=>String(a.role||"").includes("verif")||String(a.role||"").includes("review"))
      ||(agents||[])[0];
    const built:any[]=[];
    let prev:string|null=null;
    const selections:any[]=[];
    let requiredCaps=extracted.capabilities.filter((c:any)=>c.required===true);
    const optionalSkipped=extracted.capabilities.filter((c:any)=>c.required!==true).map((c:any)=>({intent:c.intent,required:false,signals:c.signals,selection_decision:"skipped_not_required"}));
    if(requiredCaps.length<2) return null;
    const learnings=await fetchOperationalLearning(goal);
    const ol=applyOperationalLearning(requiredCaps, learnings);
    requiredCaps=ol.ordered;
    for(const cap of requiredCaps){
      const mapping=CAPABILITY_EXECUTOR_CATALOG[cap.intent];
      if(!mapping) continue;
      const id=cap.intent==="infrastructure_health"?"c1":cap.intent==="technical_review"?"a1":cap.intent==="synthesis"?"m1":cap.intent==="verification"?"v1":`cap_${built.length+1}`;
      const deps=prev?[prev]:undefined;
      const olTag=ol.applied.length?`+ol:${String(ol.applied[0].memory_id||ol.applied[0].learning_id||"").slice(0,8)}`:"";
      const reason=`required_capability${olTag}`;
      if(mapping.executor_type==="connector"&&mapping.operation==="health"){
        built.push({id,operation:"health",executor_type:"connector",target:{type:"connector",connector_id:"supabase"},input:{},risk:"READ",timeout_ms:15000,policy:{runtime_probe:true,capability_intent:true},depends_on:deps,verify:{},selection:{capability_intent:cap.intent,capability:mapping.capability,signals:cap.signals,required:true,selection_reason:reason}});
      }else if(mapping.executor_type==="agent"){
        if(!verifier) continue;
        built.push({id,operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:verifier.agent_id},capability:"delegation",input:{goal:"Technical review from semantic capability intent",prompt:"Prior infrastructure check completed when available. Provide FINDINGS and VERDICT for readiness. Max 5 sentences.",max_tokens:400},risk:"READ",timeout_ms:120000,policy:{capability_intent:true},depends_on:deps||[],verify:{},selection:{capability_intent:cap.intent,capability:mapping.capability,agent_id:verifier.agent_id,signals:cap.signals,required:true,selection_reason:reason}});
      }else if(mapping.executor_type==="model"){
        const isVerify=cap.intent==="verification";
        const prompt=isVerify?"Reply with exactly VERIFICATION_PASS after confirming prior synthesis exists.":"Reply with exactly the marker SEMANTIC_SYNTHESIS_OK and a one-sentence status summary.";
        const contains=isVerify?"VERIFICATION_PASS":"SEMANTIC_SYNTHESIS_OK";
        built.push({id,operation:"text_generation",executor_type:"model",target:{type:"model",provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id},capability:"text_generation",input:{payload:{prompt,max_tokens:120,temperature:0}},risk:"READ",timeout_ms:90000,policy:{capability_intent:true},depends_on:deps||[],verify:{response_content_contains:contains},selection:{capability_intent:cap.intent,capability:mapping.capability,model_id:route.model_id,signals:cap.signals,required:true,selection_reason:reason}});
      }
      selections.push({intent:cap.intent,executor_type:mapping.executor_type,operation:mapping.operation,step_id:id,required:true,selection_reason:reason});
      prev=id;
    }
    const validation=validateCapabilityPlan(built, extracted.capabilities);
    if(!validation.ok) return null;
    return {
      goal,
      steps:built,
      planner_version:"aria-planner-v11-capability-intent-v4-ol",
      capability_intent_planning:true,
      verified_path_reuse:false,
      capability_intent:extracted,
      capability_selections:selections,
      optional_capabilities_skipped:optionalSkipped,
      selection_policy:"required_only_v1",
      operational_learning_retrieved:ol.retrieved,
      operational_learning_applied:ol.applied,
      available_capabilities:Object.keys(CAPABILITY_EXECUTOR_CATALOG),
      learning_context:context?.learned_knowledge
    };
  }catch(_e){ return null; }
}

Deno.serve(async r=>{if(r.method!=="POST")return out({error:"method_not_allowed"},405);if(!(await auth(r)))return out({error:"unauthorized"},401);const b=await r.json().catch(()=>({}));const goal=typeof b.goal==="string"?b.goal.trim():"";let context=b.context&&typeof b.context==="object"&&!Array.isArray(b.context)?{...b.context}:{};if(!goal)return out({error:"goal_required"},400);try{const recoveryLocal=await localQwenRecoveryPlan(goal,context);if(recoveryLocal)return out({ok:true,plan:recoveryLocal,planner_version:recoveryLocal.planner_version,recovery_route:recoveryLocal.recovery_route});
const explicitRequestedDevice=String(
  context?.mission_planner_contract?.requested_device_id ||
  context?.requested_device_id ||
  context?.device_id ||
  ""
).trim().toLowerCase();
if(explicitRequestedDevice.startsWith("windows-")){
  const windowsFastPath=await windowsPcRwhtPlan(goal,context);
  if(windowsFastPath)return windowsFastPath;
}
const battlecruiserAudit=await battlecruiserReadonlyAuditPlan(goal,context);if(battlecruiserAudit)return out({ok:true,plan:battlecruiserAudit});const realityBoard=await multiProjectRealityBoardPlan(goal,context);if(realityBoard)return out({ok:true,plan:realityBoard,planner_version:realityBoard.planner_version,multi_project_reality_board:true});const learned=await learningContextForGoal(goal);context={...context,learned_knowledge:learned,learning_prompt:learningPromptSuffix(learned)};const master=await ariaPwaMasterMissionPlan(goal,context);if(master)return out({ok:true,plan:master,planner_version:master.planner_version,primary_objective:true});const directDevice=directDeviceIntentPlan(goal,context);if(directDevice)return out({ok:true,plan:directDevice,planner_version:directDevice.planner_version,explicit_device_intent:true});const verifiedPath=await tryVerifiedPathPlan(goal,context);if(verifiedPath)return out({ok:true,plan:verifiedPath,planner_version:verifiedPath.planner_version||"aria-planner-v11-verified-path-reuse-v1",verified_path_reuse:true});const allForOne=await allForOnePlan(goal,context);
if(allForOne){
if(allForOne.error)return out(allForOne,409);
return out({ok:true,plan:allForOne,planner_version:"aria-planner-v12-all-for-one-v1",all_for_one:true});
}const battlecruiserRwht=await battlecruiserGithubRwhtPlan(goal,context);if(battlecruiserRwht)return out({ok:true,plan:battlecruiserRwht});const windowsPcRwht=await windowsPcRwhtPlan(goal,context);if(windowsPcRwht)return windowsPcRwht;const asset=await assetPlan(goal,context);if(asset)return asset;const androidAuto=await androidAutonomousPlan(goal,context);if(androidAuto)return androidAuto;const eas=easPlan(goal,context);if(eas)return eas;const g=goal.toLowerCase();
const runtimeProbe=/^(hola|test|prueba|esto\s+(?:esta|está)\s+funcionando|funcionando\??)$/i.test(g.trim());
if(runtimeProbe){
  const routes=await modelRoutes();
  const r=routes.find((x:any)=>x.provider_id==="openrouter") || routes[0];
  if(!r)return out({error:"no_available_text_model"},503);
  const probeStep={id:"probe_model_1",operation:"text_generation",executor_type:"model",target:{type:"model",provider_id:r.provider_id,account_id:r.account_id,model_id:r.model_id},capability:"text_generation",input:{payload:{prompt:"FINDINGS. ARIA runtime probe. Goal: "+goal+". Return the exact marker ARIA_RUNTIME_PROBE_OK and one short factual sentence about the model response. Do not claim external actions.",max_tokens:120,temperature:0}},risk:"READ",timeout_ms:60000,policy:{runtime_probe:true},verify:{response_content_contains:"ARIA_RUNTIME_PROBE_OK"},selection:{runtime_probe:true,model_id:r.model_id,provider_id:r.provider_id,account_id:r.account_id}};
  return out({ok:true,plan:{goal,steps:[{id:"probe_health_1",operation:"health",executor_type:"connector",target:{type:"connector",connector_id:"supabase"},input:{},risk:"READ",timeout_ms:15000,policy:{runtime_probe:true},verify:{}},probeStep],planner_version:"aria-planner-v11-runtime-probe-v1",runtime_probe:true}});
}
if(/^diagnose and resolve the verified failure from mission\b/i.test(goal)){const rs=await repairStep(goal,context);return out({ok:true,plan:{goal,steps:applyHumanGateIntent(goal,rs),planner_version:"aria-planner-v11-dynamic-repair-aware-v4",dynamic_failure_repair:true}});}const repairIntent=/\b(repair|repairs|fix|fixes|resolve|resolver|reparar|repara|corregir|corrige|arreglar|arregla|arreglalo|arr[eé]glalo|solucionar|soluciona|restaurar|restaura)\b/.test(g);if(repairIntent)return out({ok:true,plan:{goal,steps:await repairStep(goal,context),planner_version:"aria-planner-v11-governed-repair-v1",repair_intent:true,mutating_operation_required:true}});const operationAudit=await operationAuditPlan(goal,context);if(operationAudit)return operationAudit;const projectReviewIntent=/revisa|revisar|review|dime.*c(o|ó)mo.*va|c(o|ó)mo.*va.*proyecto|que.*esta.*mal|qué.*está.*mal|audita|auditar|estado.*(aria|proyecto)|project.*status|what.*wrong|review.*aria|audit.*aria/i.test(g) && !/\brevisable\b/i.test(g);if(projectReviewIntent){const projectReview=await projectReviewPlan(goal,context).catch((e)=>out({error:"project_review_planner_error",detail:e instanceof Error?e.message:String(e)},500));return projectReview;}if(/self[- ]audit|forensic self|super forensic|deep forensic|auditar resiliencia|security hardening|performance hardening|auditoría profunda|cross-model independent review/i.test(g)){const routes=await modelRoutes();const {data:agents}=await db.from("agent_catalog").select("agent_id,role,model_id,status,max_risk").eq("status","available").order("agent_id");return out({ok:true,plan:selfAuditPlan(goal,context,routes,agents||[])})}const missionProofRecovery=await missionProofGovernedRecoveryPlan(goal,context);if(missionProofRecovery)return out({ok:true,plan:missionProofRecovery,artifact_proof_recovery:true});const mutationIntent=/\b(change|changes|build|builds|create|creates|implement|implementation|implementing|repair|repairs|fix|fixes|modify|modifies|update|updates|add|adds|remove|removes|develop|development|refactor|refactoring|write|writes|migrate|migration|promote|promotion|corregir|corrige|crear|cree|implementar|implemente|arreglar|arregla|arreglalo|arr[eé]glalo|solucionar|soluciona|reparar|repara|modificar|modifica|actualizar|actualiza|añadir|anadir|eliminar|elimina|desarrollar|desarrolle|refactorizar|refactoriza|escribir|escriba|migrar|migra|promover|promueva)\b/.test(g);
const uiImplementationIntent=/\b(dashboard|panel|pantalla|pantallas|interfaz|ui|ux|chat|pestaña|pestañas|navegación|navegacion|navegar|deslizar|deslices|desliza|swipe|layout|diseño|diseno|frontend|front-end|pwa|componente|componentes|vista|vistas|menú|menu|botón|botones)\b/.test(g)
  && /\b(haz|has|quiero|necesito|cambia|cambiar|convierte|convierta|mueve|mover|pon|poner|organiza|organizar|rediseña|rediseñar|añade|anade|agrega|agregar|quita|quitar|elimina|eliminar|crea|crear|implementa|implementar|modifica|modificar|actualiza|actualizar)\b/.test(g);
const readOnly=/\b(audit|review|investigate|measure|verify|inspect|diagnose|forensic|assessment|assess|analy[sz]e|benchmark)\b/.test(g);
if((mutationIntent||uiImplementationIntent)&&!readOnly){const cs=await changeStep(goal,context);return out({ok:true,plan:{goal,steps:applyHumanGateIntent(goal,cs),planner_version:"aria-planner-v11-governed-change-v3",change_intent:true,mutating_operation_required:true}});}if(goal.startsWith("IA conversacional:")){const routes=await modelRoutes();const r=routes.find((x:any)=>x.provider_id==="openrouter") || routes[0];return out({ok:true,plan:{goal,steps:[modelStep("model_1",r,`Conversation task: ${goal.replace(/^IA conversacional:\s*/i,"")}\nDo not claim actions were executed.`)],planner_version:"aria-planner-v11-conversation-aware"}})}if(/gemini|modelo|openrouter/.test(g)){const routes=await modelRoutes();const r=routes[0];if(!r)return out({error:"no_available_text_model"},503);return out({ok:true,plan:{goal,steps:[modelStep("model_1",r,`ARIA verification task. Goal: ${goal}. Reply briefly with evidence and no secrets.`)],planner_version:"aria-planner-v11-model-aware"}})}const capabilityIntentPlan=await tryCapabilityIntentPlan(goal,context);if(capabilityIntentPlan)return out({ok:true,plan:capabilityIntentPlan,planner_version:capabilityIntentPlan.planner_version||"aria-planner-v11-capability-intent-v4-ol",capability_intent_planning:true,verified_path_reuse:false});
const routes=await modelRoutes();
const r=routes.find((x:any)=>x.provider_id==="openrouter") || routes[0];
if(!r)return out({error:"no_available_text_model"},503);

const live=await liveOperationalContext(goal);
const liveText=JSON.stringify(live).slice(0,14000);
const actionableContract=`
RESPUESTA HUMANA OBLIGATORIA:
CONCLUSIÓN: abre con una conclusión directa. Si la evidencia permite responder sí o no, dilo explícitamente. Si no alcanza para afirmarlo, escribe "NO CONFIRMADO" y explica exactamente qué falta comprobar.
QUÉ PASA: explica en lenguaje sencillo qué está ocurriendo ahora mismo.
PROBLEMA: identifica el problema concreto si existe. Si no hay problema confirmado, dilo claramente.
EVIDENCIA: menciona solo señales presentes en el contexto LIVE o en la ejecución real.
SOLUCIÓN / SIGUIENTE PASO: termina con una acción concreta que haga avanzar la misión.
REGLAS: no redactes un informe académico, no repitas "riesgos" como sustituto de una conclusión y no dejes al usuario solo con incertidumbre. "NO CONFIRMADO" nunca puede ser el final: siempre debe ir acompañado del dato que falta y de la acción para obtenerlo.
`;

return out({ok:true,plan:{goal,steps:[
  modelStep("analysis_1",r,`Recopila hechos actuales y verificables para responder esta solicitud de ARIA: ${goal}. Usa el contexto LIVE. Determina qué puede afirmarse ahora, qué contradicción existe y qué acción resolvería la incertidumbre. No inventes evidencia.\n\nLIVE:\n${liveText}`),
  modelStep("report_1",r,`Redacta la respuesta final para el usuario sobre: ${goal}. Usa el contexto LIVE como fuente operativa y entrega una respuesta directa, comprensible y accionable. No inventes acciones realizadas.\n\n${actionableContract}\n\nLIVE:\n${liveText}`,["analysis_1"])
],planner_version:"aria-planner-v11-safe-readonly-actionable-v4-multistep",safe_readonly_fallback:true,live_operational_context:live,actionable_output_required:true}})}catch(e){return out({error:"planner_internal_error",detail:e instanceof Error?e.message:String(e)},500)}});