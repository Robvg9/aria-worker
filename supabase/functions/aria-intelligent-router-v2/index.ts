import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")||"";
const sb=createClient(SUPABASE_URL,SERVICE_ROLE,{auth:{persistSession:false,autoRefreshToken:false}});
const VERSION="aria-intelligent-router-v2.0.0";
const RISK:{[k:string]:number}={low:0,medium:1,high:2,critical:3};
const RULES=[
  {domain:"coding",re:/\b(code|coding|debug|bug|refactor|program|implementation|typescript|javascript|sql|patch|fix)\b/i,roles:["coder"]},
  {domain:"research",re:/\b(research|investigate|sources|compare|literature|synthesis|analysis)\b/i,roles:["researcher"]},
  {domain:"planning",re:/\b(plan|planning|decompose|roadmap|architecture|break down)\b/i,roles:["planner"]},
  {domain:"verification",re:/\b(verify|verification|review|audit|test|regression|check)\b/i,roles:["reviewer","verifier"]},
  {domain:"security",re:/\b(security|threat|vulnerability|attack|secret|permission|auth)\b/i,roles:["security"]},
  {domain:"memory",re:/\b(memory|recall|remember|consolidate|knowledge)\b/i,roles:["memory"]},
  {domain:"device",re:/\b(device|windows|android|computer|hardware|diagnostic)\b/i,roles:["device"]},
  {domain:"business",re:/\b(business|strategy|sales|market|customer|pricing)\b/i,roles:["business"]}
];
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const auth=(r:Request)=>{const h=r.headers.get("authorization")||"";return !!SECRET&&h.startsWith("Bearer ")&&h.slice(7)===SECRET;};
const complexityFor=(task:string,explicit?:string)=>{
  if(explicit&&["low","medium","high","critical"].includes(explicit))return explicit;
  if(/critical|production|irreversible|destructive|security|migration/i.test(task))return "critical";
  if(/complex|architecture|multi[- ]step|debug|research|deep|audit/i.test(task)||task.length>240)return "high";
  if(/write|summarize|classify|extract|transform|explain/i.test(task)||task.length>80)return "medium";
  return "low";
};
const domainsFor=(task:string)=>RULES.filter(x=>x.re.test(task)).map(x=>x.domain);
const riskAllowed=(maxRisk:string|undefined,taskRisk:string)=>{const a=RISK[maxRisk||"medium"],b=RISK[taskRisk||"low"];return Number.isFinite(a)&&Number.isFinite(b)&&a>=b;};
const num=(v:unknown)=>Number.isFinite(Number(v))?Number(v):null;
function freeCost(pr:any){const tier=String(pr?.tier||pr?.billing_tier||"").toLowerCase();if(tier==="free"||pr?.cost==="$0"||pr?.cost===0)return 1;const input=num(pr?.input_per_1m_tokens??pr?.cost_per_1k_input_usd),output=num(pr?.output_per_1m_tokens??pr?.cost_per_1k_output_usd);if(input===0&&output===0)return 1;if(input!==null||output!==null)return .5;return null;}
function scoreCandidate(c:any,task:string,capability:string,taskRisk:string,domains:string[],allLatencies:number[]){
  const hard:string[]=[];
  if(c.status!=="available"||c.enabled!==true)hard.push("model_unavailable");
  if(c.integration_status==="not_connected")hard.push("integration_not_connected");
  if(c.capability_verified!==true)hard.push("capability_not_verified");
  if(c.account_status!=="available"||c.account_enabled!==true)hard.push("account_inactive");
  if(["unavailable","exhausted"].includes(String(c.quota_status)))hard.push("capacity_unavailable");
  if(["unavailable","exhausted"].includes(String(c.rate_limit_status)))hard.push("rate_limit_unavailable");
  if(c.live_verified!==true)hard.push("live_not_verified");
  const agents=Array.isArray(c.agents)?c.agents.filter((a:any)=>a?.status==="available"&&riskAllowed(a?.max_risk,taskRisk)):[];
  if(Array.isArray(c.agents)&&c.agents.length&&!agents.length)hard.push("no_agent_with_required_risk");
  if(taskRisk==="critical"&&domains.length===0&&!agents.some((a:any)=>["security","reviewer","verifier","planner"].includes(String(a.role||""))))hard.push("critical_requires_specialist");
  if(c.context_window!==null&&Math.ceil(task.length/4)>Number(c.context_window))hard.push("context_too_small");
  if(hard.length)return {hard,selectedAgent:null};
  const attempts=num(c.attempts)??0,successes=num(c.successes)??0,reliability=attempts>0?Math.max(0,Math.min(1,successes/attempts)):null;
  const latency=num(c.avg_latency_ms),finiteLat=allLatencies.filter(Number.isFinite);
  const latencyScore=latency===null?null:(Math.max(...finiteLat)===Math.min(...finiteLat)?1:(Math.max(...finiteLat)-latency)/(Math.max(...finiteLat)-Math.min(...finiteLat)));
  const specialistAgents=agents.filter((a:any)=>domains.some(d=>{const rule=RULES.find(x=>x.domain===d);return rule?.roles.includes(String(a.role));}));
  const specialization=specialistAgents.length?1:(agents.some((a:any)=>Array.isArray(a.capabilities)&&a.capabilities.includes(capability))?.45:.5);
  const cost=freeCost(c.pricing);
  const direct=String(c.metadata?.access_path||"").includes("direct")?1:.5;
  const score=.20+.15+.20*(reliability??.25)+.15*(latencyScore??.25)+.10*(cost??.25)+.15*specialization+.05*direct;
  return {hard:[],selectedAgent:(specialistAgents[0]||agents[0]||null),score:Number(score.toFixed(6)),evidence:{complexity:complexityFor(task),task_risk:taskRisk,domains,reliability:{state:reliability===null?"unknown":"observed",attempts,successes,score:reliability},latency:{state:latency===null?"unknown":"observed",avg_latency_ms:latency,score:latencyScore},cost_state:cost===null?"unknown":cost,specialization:{score:specialization,matches:specialistAgents.map((a:any)=>a.agent_id)},live_verified:true,capability_verified:true,direct_path:direct}};
}
function selectOne(candidates:any[],input:any){
  const task=String(input?.task||"").trim();if(!task)return{status:"no_route",reason:"task_required",version:VERSION};
  const capability=String(input?.capability||"text_generation").trim(),complexity=complexityFor(task,input?.complexity),taskRisk=String(input?.risk||complexity),domains=domainsFor(task),latencies=candidates.map((c:any)=>num(c.avg_latency_ms)).filter(Number.isFinite);
  const ranked:any[]=[];const rejected:any[]=[];
  for(const c of candidates){if(c.capability_id!==capability||c.capability_verified!==true)continue;const x=scoreCandidate(c,task,capability,taskRisk,domains,latencies);if(x.hard.length){rejected.push({model_id:c.model_id,reasons:x.hard});continue;}ranked.push({...c,score:x.score,selection_evidence:x.evidence,selected_agent_id:x.selectedAgent?.agent_id||null,selected_agent_role:x.selectedAgent?.role||null});}
  const preferredModel=input?.preferred_model,preferredProvider=input?.preferred_provider;
  ranked.sort((a,b)=>preferredModel?(a.model_id===preferredModel?-1:0)-(b.model_id===preferredModel?-1:0)||b.score-a.score:preferredProvider?(a.provider_id===preferredProvider?-1:0)-(b.provider_id===preferredProvider?-1:0)||b.score-a.score:b.score-a.score||String(a.provider_id).localeCompare(String(b.provider_id))||String(a.model_id).localeCompare(String(b.model_id)));
  if(!ranked.length)return{status:"no_route",reason:"no_eligible_candidate",version:VERSION,complexity,task_risk:taskRisk,domains,rejected_candidates:rejected};
  const w=ranked[0];
  return{status:"selected",version:VERSION,capability,task,complexity,task_risk:taskRisk,domains,selected:{provider_id:w.provider_id,account_id:w.account_id,model_id:w.model_id,capability,agent_id:w.selected_agent_id,agent_role:w.selected_agent_role},score:w.score,selection_evidence:w.selection_evidence,fallback:ranked.slice(1,4).map((x:any,i:number)=>({rank:i+2,provider_id:x.provider_id,account_id:x.account_id,model_id:x.model_id,agent_id:x.selected_agent_id,score:x.score})),candidates_considered:ranked.length,rejected_candidates:rejected};
}
function parallelPlan(tasks:any[],maxParallel:number){
  if(!Array.isArray(tasks)||!tasks.length)return{status:"no_plan",reason:"tasks_required"};
  const ids=new Set<string>();for(const t of tasks){const id=String(t?.id||"");if(!id||ids.has(id))return{status:"blocked",reason:"duplicate_or_missing_task_id"};ids.add(id);}
  const normalized=tasks.map(t=>({...t,id:String(t.id),depends_on:Array.isArray(t.depends_on)?t.depends_on.map(String):[]}));for(const t of normalized)for(const d of t.depends_on)if(!ids.has(d)||d===t.id)return{status:"blocked",reason:"invalid_dependency",task_id:t.id,dependency:d};
  const batches:string[][]=[],done=new Set<string>(),limit=Math.max(1,Math.floor(maxParallel||2));
  while(done.size<normalized.length){const ready=normalized.filter(t=>!done.has(t.id)&&t.depends_on.every((d:string)=>done.has(d))).slice(0,limit);if(!ready.length)return{status:"blocked",reason:"dependency_cycle"};batches.push(ready.map(t=>t.id));ready.forEach(t=>done.add(t.id));}
  return{status:"planned",max_parallel:limit,batches};
}
Deno.serve(async r=>{
  if(r.method!=="POST")return out({error:"method_not_allowed"},405);
  if(!auth(r))return out({error:"unauthorized"},401);
  const body=await r.json().catch(()=>({}));
  try{
    const {data:snapshot,error:se}=await sb.rpc("router_live_snapshot");if(se)throw new Error(se.message);
    const candidates=Array.isArray(snapshot?.candidates)?snapshot.candidates:[];
    let payload:any;
    if(Array.isArray(body?.tasks)){
      const selections=body.tasks.map((t:any)=>({...selectOne(candidates,{...t,capability:t.capability||body.capability||"text_generation",risk:t.risk||body.risk}),id:String(t.id)}));
      const plan=parallelPlan(body.tasks,Number(body.max_parallel||2));
      payload={status:plan.status==="planned"?"selected":"blocked",version:VERSION,selections,parallel_plan:plan};
      const recorded=await sb.rpc("record_router_decision",{p_decision:{decision_id:"router_"+crypto.randomUUID(),trace_id:body.trace_id||null,task:body.task||"parallel_batch",capability_id:body.capability||"text_generation",complexity:"mixed",selected:null,fallback:selections.map((x:any)=>x.fallback||[]),evidence:{parallel:true,planner:plan},candidates_considered:candidates.length,rejected:selections.flatMap((x:any)=>x.rejected_candidates||[]),parallel_plan:plan}});
      payload.persistence=recorded.error?{recorded:false,error:recorded.error.message}:{recorded:true,decision_id:recorded.data?.decision_id};
    }else{
      payload=selectOne(candidates,body);
      const recorded=await sb.rpc("record_router_decision",{p_decision:{decision_id:"router_"+crypto.randomUUID(),trace_id:body.trace_id||null,task:body.task||"",capability_id:body.capability||"text_generation",complexity:payload.complexity||complexityFor(String(body.task||"")),selected:payload.selected||null,fallback:payload.fallback||[],evidence:payload.selection_evidence||{},candidates_considered:payload.candidates_considered||0,rejected:payload.rejected_candidates||[],parallel_plan:null}});
      payload.persistence=recorded.error?{recorded:false,error:recorded.error.message}:{recorded:true,decision_id:recorded.data?.decision_id};
    }
    return out(payload);
  }catch(e){return out({status:"failed",version:VERSION,error:e instanceof Error?e.message:String(e)},500);}
});