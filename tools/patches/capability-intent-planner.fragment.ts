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

