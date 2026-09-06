import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateCandidates, selectDynamicGoal } from "../_shared/dynamic-goal-engine.mjs";
const URL=Deno.env.get("SUPABASE_URL")!,KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")!;
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const eq=(a:string,b:string)=>a.length===b.length&&[...a].reduce((n,_,i)=>n|(a.charCodeAt(i)^b.charCodeAt(i)),0)===0;
async function auth(r:Request){const h=r.headers.get("authorization")||"",t=h.startsWith("Bearer ")?h.slice(7):"",c=r.headers.get("x-aria-autonomy-token")||"";if(SECRET&&t&&eq(t,SECRET))return true;const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:c});return !error&&data===true}
async function recover(){const {data,error}=await sb.rpc("aria_autonomy_recover_stale_missions",{p_stale_after:"00:02:00"});if(error)throw new Error(error.message);return Number(data||0)}
async function learn(){const cut=new Date(Date.now()-6*60*60*1000).toISOString();const {data,error}=await sb.schema("aria_internal").from("mission_state").select("mission_id,goal,status,metadata,last_stderr,last_stdout,updated_at,created_at").in("status",["succeeded","blocked","failed","timeout","cancelled"]).gt("updated_at",cut);if(error)throw new Error(error.message);let created=0;for(const m of data||[]){const {data:e}=await sb.schema("aria_internal").from("autonomy_learnings").select("lesson_id").eq("mission_id",m.mission_id).limit(1);if(e?.length)continue;const {error:ie}=await sb.schema("aria_internal").from("autonomy_learnings").insert({mission_id:m.mission_id,goal_id:m.metadata?.goal_id??null,category:m.status==="succeeded"?"verified_success":"operational_failure",summary:`Observed ${m.status}: ${(m.goal||"").slice(0,220)}`,evidence:{status:m.status,stderr:m.last_stderr||null,stdout_sample:(m.last_stdout||"").slice(0,800)},confidence:m.status==="succeeded"?0.9:0.75,reusable:true});if(!ie)created++}return {scanned:data?.length||0,created}}
async function dynamicGoalPool(){
  const now=new Date().toISOString();
  const [goalsRes, failuresRes, gapsRes, learningsRes] = await Promise.all([
    sb.schema("aria_internal").from("autonomy_goals").select("*").in("status",["queued","paused","running","blocked","completed"]),
    sb.schema("aria_internal").from("mission_state").select("mission_id,goal,status,last_stderr,last_stdout,updated_at,created_at,metadata").in("status",["failed","blocked","timeout"]).order("updated_at",{ascending:false}).limit(20),
    sb.schema("aria_internal").from("capability_matrix").select("model_id,capability_id,status,evidence_type,evidence_ref,verified_at,notes,metadata,updated_at").neq("status","verified").order("updated_at",{ascending:false}).limit(30),
    sb.schema("aria_internal").from("autonomy_learnings").select("lesson_id,mission_id,goal_id,category,summary,evidence,confidence,reusable,created_at").eq("reusable",true).order("created_at",{ascending:false}).limit(30)
  ]);
  for (const r of [goalsRes, failuresRes, gapsRes, learningsRes]) if (r.error) throw new Error(r.error.message);
  const goals=(goalsRes.data||[]);
  const candidates=generateCandidates({goals,failures:failuresRes.data||[],capabilityGaps:gapsRes.data||[],learnings:learningsRes.data||[]},{now});
  const existingById=new Map(goals.map((g:any)=>[g.goal_id,g]));
  const existingFingerprints=new Set(goals.map((g:any)=>String(g.goal||"").trim().toLowerCase().replace(/\s+/g," ")));
  const blockedIds=new Set(goals.filter((g:any)=>["blocked","completed"].includes(g.status)).map((g:any)=>g.goal_id));
  const activeIds=new Set(goals.filter((g:any)=>g.status==="running").map((g:any)=>g.goal_id));
  const generated=[];
  for(const c of candidates.slice(0,25)){
    if(existingById.has(c.goal_id)||existingFingerprints.has(String(c.goal||"").trim().toLowerCase().replace(/\s+/g," "))) continue;
    const {error}=await sb.schema("aria_internal").from("autonomy_goals").insert({goal_id:c.goal_id,goal:c.goal,priority:Math.round(c.priority),status:"queued",next_run_at:now,attempts:0,max_attempts:3,source_type:c.source_type,source_ref:c.source_ref||null,dynamic_score:c.dynamic_score,metadata:c.metadata||{dynamic:true}});
    if(error && !String(error.message||"").toLowerCase().includes("duplicate")) throw new Error(error.message);
    if(!error){generated.push(c.goal_id);existingById.set(c.goal_id,{...c,status:"queued"});}
  }
  const refreshed=[...existingById.values()].map((g:any)=>({...g,status:g.status||"queued"}));
  const eligible=refreshed.filter((g:any)=>g.status==="queued" && new Date(g.next_run_at||now).getTime()<=Date.now());
  const ranked=generateCandidates({goals:eligible},{now});
  const selected=selectDynamicGoal(ranked,{blockedIds,activeIds});
  return {selected,candidate_count:candidates.length,generated_count:generated.length,generated_ids:generated};
}
async function makeMission(g:any){const id=`mission_${crypto.randomUUID()}`,sd=g.goal_id==="autonomy-selfdevelopment-audit";const {data,error}=await sb.rpc("aria_mission_create",{p_mission:{mission_id:id,status:"queued",goal:g.goal,current_step:0,completed_steps:0,checkpoint:{dynamic_goal_selection:{goal_id:g.goal_id,score:g.dynamic_score,source_type:g.source_type,source_ref:g.source_ref}},metadata:{source:"autonomy_supervisor_v10_dynamic_goal_engine_v1",goal_id:g.goal_id,policy:"safe-progress-v6",dynamic_goal:true,dynamic_score:g.dynamic_score??null,goal_source:g.source_type??null,self_development:sd,self_development_mode:sd?"audit_only":null,human_gate_required:["HIGH_RISK_WRITE","destructive","production_merge"]}}});if(error)throw new Error(error.message);const {error:ue}=await sb.schema("aria_internal").from("autonomy_goals").update({status:"running",attempts:(g.attempts||0)+1,last_mission_id:id,updated_at:new Date().toISOString()}).eq("goal_id",g.goal_id);if(ue)throw new Error(ue.message);return data}
Deno.serve(async r=>{if(r.method!=="POST")return out({error:"method_not_allowed"},405);if(!(await auth(r)))return out({error:"unauthorized"},401);try{const recovered=await recover(),learning=await learn();const {count,error}=await sb.schema("aria_internal").from("mission_state").select("mission_id",{count:"exact",head:true}).in("status",["planning","running"]);if(error)throw new Error(error.message);const active=count||0;let goal=null,mission=null,dynamic=null;if(active===0){dynamic=await dynamicGoalPool();goal=dynamic.selected;if(goal)mission=await makeMission(goal)}return out({ok:true,recovered,learning,active_before:active,goal_id:goal?.goal_id??null,dynamic_score:goal?.dynamic_score??null,goal_source:goal?.source_type??null,candidate_count:dynamic?.candidate_count??0,generated_count:dynamic?.generated_count??0,mission_created:mission?.mission_id??null})}catch(e){return out({ok:false,error:e instanceof Error?e.message:String(e)},200)}});