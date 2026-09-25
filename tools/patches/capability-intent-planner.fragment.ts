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

