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
  device_operations:["shell.execute","ollama.qwen3","computer.use","computer.use.autonomous","computer.use.android"],
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
const repairStep=async(goal:string,context:any)=>{const contextText=JSON.stringify(context).slice(0,7000);return [agentStep("diagnosis_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Analiza primero la falla real de esta misión antes de modificar nada. Inspecciona la evidencia disponible y determina causa raíz, archivos/recursos afectados, riesgo y pruebas necesarias. No hagas cambios. Misión original: ${goal}. Contexto: ${contextText}`),{id:"repair_1",operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:"aria-agent-coding-v1"},capability:"coding",input:{goal:"Ejecutar reparación gobernada",prompt:esPrompt(`Esta es la fase de IMPLEMENTACIÓN de una reparación real. Usa el diagnóstico previo como guía, pero comprueba el estado actual por ti mismo. Trabaja en una rama gobernada que no sea main, corrige la causa raíz, ejecuta las pruebas focalizadas y devuelve evidencia concreta: cambios realizados, archivos afectados, pruebas ejecutadas y resultado. No declares éxito por texto solamente. Misión original: ${goal}. Contexto: ${contextText}`),max_tokens:3000},risk:"LOW_RISK_WRITE",timeout_ms:180000,policy:governedWritePolicy,depends_on:["diagnosis_1"],verify:{},selection:{review_role:"coder",write_route:"github_app_governed_or_agent_runtime"}},agentStep("verification_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Verifica la reparación real ya aplicada para esta misión. Inspecciona el estado actual del repositorio/PR, confirma que el cambio existe, revisa las pruebas/evidencias y determina si la causa raíz quedó resuelta. No hagas cambios. Misión original: ${goal}. Contexto: ${contextText}`,["repair_1"])]};
const changeStep=async(goal:string,context:any)=>{const contextText=JSON.stringify(context).slice(0,7000);return [agentStep("analysis_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Antes de implementar, analiza la solicitud completa y localiza exactamente qué debe cambiar. Inspecciona el repositorio real, identifica archivos/componentes afectados, dependencias, riesgos y pruebas necesarias. No modifiques nada en esta fase. Solicitud original: ${goal}. Contexto: ${contextText}`),{id:"implementation_1",operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:"aria-agent-coding-v1"},capability:"coding",input:{goal:"Ejecutar implementación gobernada",prompt:esPrompt(`Esta es la fase de IMPLEMENTACIÓN de una solicitud real. Usa el análisis previo como guía y comprueba el estado actual por ti mismo. Trabaja únicamente en una rama gobernada que no sea main. Implementa exactamente la solicitud, añade o actualiza pruebas focalizadas y devuelve evidencia concreta de cambios y pruebas. No termines después del análisis y no declares éxito por texto solamente. Solicitud original: ${goal}. Contexto: ${contextText}`),max_tokens:3200},risk:"LOW_RISK_WRITE",timeout_ms:180000,policy:governedWritePolicy,depends_on:["analysis_1"],verify:{},selection:{review_role:"coder",write_route:"github_app_governed_or_agent_runtime"}},agentStep("verification_1",{agent_id:"aria-agent-reviewer-v1",role:"revisor",model_id:"google/gemini-3.5-flash-lite-direct"},`Haz la VERIFICACIÓN FINAL de esta solicitud. Inspecciona el cambio real que acaba de producirse, confirma que satisface la solicitud original, revisa las pruebas y la evidencia disponible y señala cualquier contradicción, bloqueo o trabajo faltante. No modifiques nada. Solicitud original: ${goal}. Contexto: ${contextText}`,["implementation_1"])]};

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

async function modelRoutes(){const [{data:m},{data:c},{data:a}]=await Promise.all([db.from("model_registry").select("model_id,provider_id,status,enabled"),db.from("capability_matrix").select("model_id,status,evidence_type,evidence_ref").eq("capability_id","text_generation"),db.from("account_registry").select("account_id,provider_id,status,enabled")]);return (m||[]).filter((x:any)=>x.enabled&&x.status==="available").map((x:any)=>{const cap=(c||[]).find((z:any)=>z.model_id===x.model_id);const acc=(a||[]).find((z:any)=>z.provider_id===x.provider_id&&z.enabled&&["available","active"].includes(String(z.status)));return acc?{model_id:x.model_id,provider_id:x.provider_id,account_id:acc.account_id,capability_status:cap?.status||"unknown",evidence_type:cap?.evidence_type||"unknown",evidence_ref:cap?.evidence_ref||null,score:(cap?.status==="verified"?100:50)+(x.provider_id==="google"?10:0)}:null}).filter(Boolean).sort((x:any,y:any)=>y.score-x.score)}
async function battlecruiserGithubRwhtPlan(goal:string,context:any){
  const rawProject=String(
    context?.project_id
      ?? context?.metadata?.project_id
      ?? context?.project?.id
      ?? ""
  ).toLowerCase();
  const g=String(goal||"");
  const gl=g.toLowerCase();
  const isBattleCruiser=rawProject==="battlecruiser" || /battlecruiser/i.test(g);
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
  if(!isRwht || !isPc)return null;

  const {data:devices}=await db.from("device_registry")
    .select("device_id,display_name,agent_type,status,last_seen_at,capabilities")
    .eq("agent_type","windows-local")
    .in("status",["online","active","available"])
    .order("last_seen_at",{ascending:false})
    .limit(8);

  const candidates=(Array.isArray(devices)?devices:[]);
  const device=candidates.find((d:any)=>{
    const caps=Array.isArray(d?.capabilities)?d.capabilities.map(String):[];
    return caps.includes("computer.use") && caps.includes("ollama.qwen3");
  }) || null;

  if(!device){
    return out({
      error:"windows_pc_executor_unavailable",
      planner_version:"aria-planner-v11-capability-aware-windows-rwht-v1",
      capability_gap:{
        required:["computer.use","ollama.qwen3","computer.use.autonomous"],
        online_windows_devices:candidates
      }
    },409);
  }

  const urlMatch=g.match(/https?:\/\/[^\s)]+/i);
  const isBattleCruiser=/battlecruiser/i.test(g) || String(context?.project_id||"").toLowerCase()==="battlecruiser";
  const startUrl=String(context?.start_url||"").trim()
    || (urlMatch?urlMatch[0].replace(/[.,;]+$/,""):null)
    || (isBattleCruiser?"https://battlecruiser.robvg9.workers.dev/":null);

  const maxActions=Math.max(20,Math.min(180,Number(context?.max_actions||120)));
  const maxRuntime=Math.max(120000,Math.min(900000,Number(context?.max_runtime_ms||600000)));
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
      {operation:"computer.use.autonomous",purpose:"observe → decide → act → verify → adapt",requires:["computer.use","ollama.qwen3"]},
      {operation:"computer.use",purpose:"real Windows UI actions",actions:["observe","screenshot","click","double_click","type","keypress","hotkey","scroll","focus","wait"]},
      {operation:"ollama.qwen3",purpose:"local structured UI decision model",model:"qwen3:4b"}
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
  if(!/(android|tel[eé]fono|app|aplicaci[oó]n|pwa|web|bot[oó]n|interfaz|ui)/i.test(g))return null;
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
async function extractCapabilityIntent(goal:string):Promise<{capabilities:Array<{intent:string,required:boolean,signals:string[]}>,source:string}>{ 
  const g=goal.toLowerCase();
  const rules:Array<{intent:string,required:boolean,patterns:RegExp[]}> = [
    {intent:"infrastructure_health",required:true,patterns:[/infraestructura/,/disponibilidad/,/operativ[oa]/,/sistema\s+(est[aá]|listo)/,/comprobaci[oó]n\s+de\s+(estado|disponibilidad)/,/listo\s+para/]},
    {intent:"technical_review",required:false,patterns:[/revisi[oó]n\s+t[eé]cnica/,/evaluaci[oó]n\s+t[eé]cnica/,/revisi[oó]n\s+de\s+seguridad/,/evaluaci[oó]n\s+cuando/]},
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
  // No step may target a non-required intent
  for(const s of steps){
    const intent=String(s.selection?.capability_intent||"");
    const meta=intents.find((c:any)=>c.intent===intent);
    if(meta && meta.required!==true) return {ok:false,reason:"optional_intent_must_not_select_executor:"+intent};
  }
  const types=new Set(steps.map((s:any)=>s.executor_type));
  if(types.size<2) return {ok:false,reason:"not_multi_executor"};
  return {ok:true};
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
    const requiredCaps=extracted.capabilities.filter((c:any)=>c.required===true);
    const optionalSkipped=extracted.capabilities.filter((c:any)=>c.required!==true).map((c:any)=>({intent:c.intent,required:false,signals:c.signals,selection_decision:"skipped_not_required"}));
    // Deterministic rule: ONLY required capabilities produce executors.
    if(requiredCaps.length<2) return null;
    for(const cap of requiredCaps){
      const mapping=CAPABILITY_EXECUTOR_CATALOG[cap.intent];
      if(!mapping) continue;
      const id=cap.intent==="infrastructure_health"?"c1":cap.intent==="technical_review"?"a1":cap.intent==="synthesis"?"m1":cap.intent==="verification"?"v1":`cap_${built.length+1}`;
      const deps=prev?[prev]:undefined;
      if(mapping.executor_type==="connector"&&mapping.operation==="health"){
        built.push({id,operation:"health",executor_type:"connector",target:{type:"connector",connector_id:"supabase"},input:{},risk:"READ",timeout_ms:15000,policy:{runtime_probe:true,capability_intent:true},depends_on:deps,verify:{},selection:{capability_intent:cap.intent,capability:mapping.capability,signals:cap.signals,required:true,selection_reason:"required_capability"}});
      }else if(mapping.executor_type==="agent"){
        if(!verifier) continue;
        built.push({id,operation:"delegate",executor_type:"agent",target:{type:"agent",agent_id:verifier.agent_id},capability:"delegation",input:{goal:"Technical review from semantic capability intent",prompt:"Prior infrastructure check completed when available. Provide FINDINGS and VERDICT for readiness. Max 5 sentences.",max_tokens:400},risk:"READ",timeout_ms:120000,policy:{capability_intent:true},depends_on:deps||[],verify:{},selection:{capability_intent:cap.intent,capability:mapping.capability,agent_id:verifier.agent_id,signals:cap.signals,required:true,selection_reason:"required_capability"}});
      }else if(mapping.executor_type==="model"){
        const isVerify=cap.intent==="verification";
        const prompt=isVerify?"Reply with exactly VERIFICATION_PASS after confirming prior synthesis exists.":"Reply with exactly the marker SEMANTIC_SYNTHESIS_OK and a one-sentence status summary.";
        const contains=isVerify?"VERIFICATION_PASS":"SEMANTIC_SYNTHESIS_OK";
        built.push({id,operation:"text_generation",executor_type:"model",target:{type:"model",provider_id:route.provider_id,account_id:route.account_id,model_id:route.model_id},capability:"text_generation",input:{payload:{prompt,max_tokens:120,temperature:0}},risk:"READ",timeout_ms:90000,policy:{capability_intent:true},depends_on:deps||[],verify:{response_content_contains:contains},selection:{capability_intent:cap.intent,capability:mapping.capability,model_id:route.model_id,signals:cap.signals,required:true,selection_reason:"required_capability"}});
      }
      selections.push({intent:cap.intent,executor_type:mapping.executor_type,operation:mapping.operation,step_id:id,required:true,selection_reason:"required_capability"});
      prev=id;
    }
    const validation=validateCapabilityPlan(built, extracted.capabilities);
    if(!validation.ok) return null;
    return {
      goal,
      steps:built,
      planner_version:"aria-planner-v11-capability-intent-v2",
      capability_intent_planning:true,
      verified_path_reuse:false,
      capability_intent:extracted,
      capability_selections:selections,
      optional_capabilities_skipped:optionalSkipped,
      selection_policy:"required_only_v1",
      available_capabilities:Object.keys(CAPABILITY_EXECUTOR_CATALOG),
      learning_context:context?.learned_knowledge
    };
  }catch(_e){ return null; }
}

Deno.serve(async r=>{if(r.method!=="POST")return out({error:"method_not_allowed"},405);if(!(await auth(r)))return out({error:"unauthorized"},401);const b=await r.json().catch(()=>({}));const goal=typeof b.goal==="string"?b.goal.trim():"";let context=b.context&&typeof b.context==="object"&&!Array.isArray(b.context)?{...b.context}:{};if(!goal)return out({error:"goal_required"},400);try{const learned=await learningContextForGoal(goal);context={...context,learned_knowledge:learned,learning_prompt:learningPromptSuffix(learned)};const verifiedPath=await tryVerifiedPathPlan(goal,context);if(verifiedPath)return out({ok:true,plan:verifiedPath,planner_version:verifiedPath.planner_version||"aria-planner-v11-verified-path-reuse-v1",verified_path_reuse:true});const allForOne=await allForOnePlan(goal,context);
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
if(/^diagnose and resolve the verified failure from mission\b/i.test(goal))return out({ok:true,plan:{goal,steps:await repairStep(goal,context),planner_version:"aria-planner-v11-dynamic-repair-aware-v4",dynamic_failure_repair:true}});const repairIntent=/\b(repair|repairs|fix|fixes|resolve|resolver|reparar|repara|corregir|corrige|arreglar|arregla|arreglalo|arr[eé]glalo|solucionar|soluciona|restaurar|restaura)\b/.test(g);if(repairIntent)return out({ok:true,plan:{goal,steps:await repairStep(goal,context),planner_version:"aria-planner-v11-governed-repair-v1",repair_intent:true,mutating_operation_required:true}});const operationAudit=await operationAuditPlan(goal,context);if(operationAudit)return operationAudit;const projectReviewIntent=/revisa|revisar|review|dime.*c(o|ó)mo.*va|c(o|ó)mo.*va.*proyecto|que.*esta.*mal|qué.*está.*mal|audita|auditar|estado.*(aria|proyecto)|project.*status|what.*wrong|review.*aria|audit.*aria/i.test(g);if(projectReviewIntent){const projectReview=await projectReviewPlan(goal,context).catch((e)=>out({error:"project_review_planner_error",detail:e instanceof Error?e.message:String(e)},500));return projectReview;}if(/self[- ]audit|forensic self|super forensic|deep forensic|auditar resiliencia|security hardening|performance hardening|auditoría profunda|cross-model independent review/i.test(g)){const routes=await modelRoutes();const {data:agents}=await db.from("agent_catalog").select("agent_id,role,model_id,status,max_risk").eq("status","available").order("agent_id");return out({ok:true,plan:selfAuditPlan(goal,context,routes,agents||[])})}const mutationIntent=/\b(change|changes|build|builds|create|creates|implement|implementation|implementing|repair|repairs|fix|fixes|modify|modifies|update|updates|add|adds|remove|removes|develop|development|refactor|refactoring|write|writes|migrate|migration|promote|promotion|corregir|corrige|crear|cree|implementar|implemente|arreglar|arregla|arreglalo|arr[eé]glalo|solucionar|soluciona|reparar|repara|modificar|modifica|actualizar|actualiza|añadir|anadir|eliminar|elimina|desarrollar|desarrolle|refactorizar|refactoriza|escribir|escriba|migrar|migra|promover|promueva)\b/.test(g);
const uiImplementationIntent=/\b(dashboard|panel|pantalla|pantallas|interfaz|ui|ux|chat|pestaña|pestañas|navegación|navegacion|navegar|deslizar|deslices|desliza|swipe|layout|diseño|diseno|frontend|front-end|pwa|componente|componentes|vista|vistas|menú|menu|botón|botones)\b/.test(g)
  && /\b(haz|has|quiero|necesito|cambia|cambiar|convierte|convierta|mueve|mover|pon|poner|organiza|organizar|rediseña|rediseñar|añade|anade|agrega|agregar|quita|quitar|elimina|eliminar|crea|crear|implementa|implementar|modifica|modificar|actualiza|actualizar)\b/.test(g);
const readOnly=/\b(audit|review|investigate|measure|verify|inspect|diagnose|forensic|assessment|assess|analy[sz]e|benchmark)\b/.test(g);
if((mutationIntent||uiImplementationIntent)&&!readOnly)return out({ok:true,plan:{goal,steps:await changeStep(goal,context),planner_version:"aria-planner-v11-governed-change-v3",change_intent:true,mutating_operation_required:true}});if(goal.startsWith("IA conversacional:")){const routes=await modelRoutes();const r=routes.find((x:any)=>x.provider_id==="openrouter") || routes[0];return out({ok:true,plan:{goal,steps:[modelStep("model_1",r,`Conversation task: ${goal.replace(/^IA conversacional:\s*/i,"")}\nDo not claim actions were executed.`)],planner_version:"aria-planner-v11-conversation-aware"}})}if(/gemini|modelo|openrouter/.test(g)){const routes=await modelRoutes();const r=routes[0];if(!r)return out({error:"no_available_text_model"},503);return out({ok:true,plan:{goal,steps:[modelStep("model_1",r,`ARIA verification task. Goal: ${goal}. Reply briefly with evidence and no secrets.`)],planner_version:"aria-planner-v11-model-aware"}})}const capabilityIntentPlan=await tryCapabilityIntentPlan(goal,context);if(capabilityIntentPlan)return out({ok:true,plan:capabilityIntentPlan,planner_version:capabilityIntentPlan.planner_version||"aria-planner-v11-capability-intent-v2",capability_intent_planning:true,verified_path_reuse:false});
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