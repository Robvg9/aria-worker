import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateCandidates, selectDynamicGoal } from "./_shared/dynamic-goal-engine.mjs";

const URL=Deno.env.get("SUPABASE_URL")!;
const KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")??"";
const INTAKE=`${URL}/functions/v1/aria-mission-intake-v1`;
const CANONICAL=`${URL}/functions/v1/aria-canonical-runtime-v1`;
const LEARNING=`${URL}/functions/v1/aria-learning-v3`;
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false,autoRefreshSession:false}});
const out=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
async function auth(r:Request){
  const t=bearer(r);
  if(t&&SECRET&&eq(t,SECRET))return true;
  const a=r.headers.get("x-aria-autonomy-token")??t;
  if(!a)return false;
  const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:a});
  return !error&&data===true;
}
function sensitive(goal:string){
  return /\b(production|prod|merge|main|master|delete|destroy|destructive|credential|secret|api[_ -]?key|password|payment|billing|purchase|deploy)\b/i.test(goal);
}
function gateFor(goal:string){
  if(!sensitive(goal)) return {enabled:false,method:null,instructions:null,reason:null};
  return {
    enabled:true,
    method:"manual_confirmation",
    instructions:"Revisar la misión y confirmar manualmente cualquier acción sensible antes de continuar.",
    reason:"La misión autónoma toca una frontera sensible de producción, credenciales, pago o cambio destructivo."
  };
}
function cycleSlot(now=new Date()){return new Date(Math.floor(now.getTime()/60000)*60000).toISOString()}
function cycleId(slot:string){return `autonomy-cycle-${slot.replace(/[:.]/g,"-")}`}

async function snapshot(){
  const {data:goals,error:ge}=await sb.schema("aria_internal").from("autonomy_goals")
    .select("goal_id,goal,priority,status,next_run_at,attempts,max_attempts,last_mission_id,created_at,updated_at,source_type,source_ref,dynamic_score,metadata")
    .in("status",["queued","paused","running","blocked","completed"])
    .order("updated_at",{ascending:false}).limit(250);
  if(ge)throw new Error(`goals:${ge.message}`);
  const {data:active,error:ae}=await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,status,updated_at,finished_at")
    .in("status",["queued","planning","running","waiting","paused"]).limit(50);
  if(ae)throw new Error(`active:${ae.message}`);
  const {data:failures,error:fe}=await sb.schema("aria_internal").from("mission_state")
    .select("mission_id,goal,status,last_stderr,checkpoint,metadata,updated_at,created_at")
    .in("status",["failed","blocked","timeout"]).gt("updated_at",new Date(Date.now()-72*3600000).toISOString())
    .order("updated_at",{ascending:false}).limit(100);
  if(fe)throw new Error(`failures:${fe.message}`);
  const {data:gaps,error:ce}=await sb.schema("aria_internal").from("capability_matrix")
    .select("model_id,capability_id,status,evidence_type,evidence_ref,verified_at,notes,metadata,updated_at")
    .neq("status","verified").order("updated_at",{ascending:false}).limit(100);
  if(ce)throw new Error(`gaps:${ce.message}`);
  const {data:learnings,error:le}=await sb.schema("aria_internal").from("autonomy_learnings")
    .select("lesson_id,goal_id,category,summary,evidence,confidence,reusable,created_at")
    .in("category",["operational_failure","verified_success","verified_procedure"]).gt("created_at",new Date(Date.now()-7*86400000).toISOString())
    .order("created_at",{ascending:false}).limit(100);
  if(le)throw new Error(`learnings:${le.message}`);
  return {
    goals:Array.isArray(goals)?goals:[],
    active:Array.isArray(active)?active:[],
    failures:Array.isArray(failures)?failures:[],
    capabilityGaps:Array.isArray(gaps)?gaps:[],
    learnings:Array.isArray(learnings)?learnings:[]
  };
}

async function ensureCandidates(candidates:any[],cycle:string){
  let inserted=0;
  for(const c of candidates.slice(0,30)){
    const {data:existing,error:ee}=await sb.schema("aria_internal").from("autonomy_goals")
      .select("goal_id,status").eq("goal_id",c.goal_id).maybeSingle();
    if(ee)throw new Error(`goal_lookup:${ee.message}`);
    if(existing)continue;
    const metadata={
      ...(c.metadata&&typeof c.metadata==="object"?c.metadata:{}),
      autonomy_cycle_id:cycle,
      generated_by:"aria-autonomy-loop-v1",
      governed:true
    };
    const {error}=await sb.schema("aria_internal").from("autonomy_goals").insert({
      goal_id:c.goal_id,
      goal:c.goal,
      priority:Math.round(Number(c.priority??50)),
      status:"queued",
      next_run_at:new Date().toISOString(),
      attempts:0,
      max_attempts:3,
      source_type:c.source_type??"dynamic",
      source_ref:c.source_ref??c.goal_id,
      dynamic_score:Number(c.dynamic_score??0),
      metadata,
      objective_verification_status:"UNVERIFIED"
    });
    if(error){
      if(String(error.message).toLowerCase().includes("duplicate"))continue;
      throw new Error(`goal_insert:${error.message}`);
    }
    inserted++;
  }
  return inserted;
}

async function createMission(goal:any,cycle:string){
  const gate=gateFor(String(goal.goal??""));
  const missionId=`auto-${cycle.replace(/[^a-z0-9-]/gi,"-")}-${String(goal.goal_id).slice(0,48)}`;
  const body={
    mission_id:missionId,
    goal:String(goal.goal),
    metadata:{
      source:"autonomy-loop-v1",
      policy_version:"autonomy-post-plan-v1",
      autonomy_cycle_id:cycle,
      goal_id:goal.goal_id,
      source_type:goal.source_type??null,
      source_ref:goal.source_ref??null,
      dynamic_score:goal.dynamic_score??null,
      human_gate:gate
    },
    checkpoint:{
      autonomy:{
        cycle_id:cycle,
        generated:true,
        governed:true,
        source_type:goal.source_type??null,
        source_ref:goal.source_ref??null
      }
    }
  };
  const r=await fetch(INTAKE,{method:"POST",headers:{"authorization":`Bearer ${SECRET}`,"content-type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>null);
  if(!r.ok||!j?.ok)throw new Error(`intake:${r.status}:${j?.error??"unknown"}`);
  await sb.schema("aria_internal").from("autonomy_goals").update({
    status:"running",last_mission_id:missionId,attempts:Number(goal.attempts||0)+1,
    updated_at:new Date().toISOString()
  }).eq("goal_id",goal.goal_id);
  return {missionId,gate};
}

async function runMission(missionId:string,trace:string){
  const r=await fetch(CANONICAL,{
    method:"POST",
    headers:{
      "authorization":`Bearer ${SECRET}`,
      "content-type":"application/json",
      "X-ARIA-Trace-Id":trace,
      "x-aria-trigger":"autonomy-7"
    },
    body:JSON.stringify({mission_id:missionId})
  });
  const j=await r.json().catch(()=>null);
  return {http_status:r.status,body:j};
}

async function learnMission(missionId:string){
  const r=await fetch(LEARNING,{
    method:"POST",
    headers:{"authorization":`Bearer ${SECRET}`,"content-type":"application/json"},
    body:JSON.stringify({mission_id:missionId})
  });
  const j=await r.json().catch(()=>null);
  return {http_status:r.status,body:j};
}

async function cycle(reqBody:any){
  const now=new Date(),slot=cycleSlot(now),id=cycleId(slot),trigger=typeof reqBody?.trigger==="string"?reqBody.trigger:"manual";
  const {data:existing}=await sb.schema("aria_internal").from("autonomy_cycles").select("*").eq("cycle_id",id).maybeSingle();
  if(existing)return {ok:true,deduplicated:true,cycle:existing};

  await sb.schema("aria_internal").from("autonomy_cycles").insert({
    cycle_id:id,cycle_slot:slot,trigger,status:"started",policy_version:"autonomy-post-plan-v1"
  });
  const recover=await sb.rpc("aria_autonomy_recover_stale_missions",{p_stale_after:"00:02:00"});
  if(recover.error)throw new Error(`recovery:${recover.error.message}`);

  let snap=await snapshot();
  const activeCount=snap.active.length;
  const generated=generateCandidates(snap,{now:now.toISOString()});
  const inserted=await ensureCandidates(generated,id);
  snap=await snapshot();

  let selected:any=null,mission:any=null,run:any=null,learning:any=null;
  if(activeCount===0){
    selected=selectDynamicGoal(generated, new Set(
      snap.goals.filter((g:any)=>["blocked","completed","running"].includes(g.status)).map((g:any)=>g.goal_id)
    ), new Set(snap.goals.filter((g:any)=>g.status==="running").map((g:any)=>g.goal_id)));
    if(!selected){
      selected=selectDynamicGoal(
        snap.goals.filter((g:any)=>g.status==="queued"||g.status==="paused"),
        new Set(), new Set()
      );
    }
    if(selected){
      mission=await createMission(selected,id);
      run=await runMission(mission.missionId,`mission7:${id}`);
      const {data:m}=await sb.schema("aria_internal").from("mission_state").select("status,last_stderr,last_exit_code,checkpoint,metadata,finished_at").eq("mission_id",mission.missionId).maybeSingle();
      if(m?.status==="succeeded"){
        learning=await learnMission(mission.missionId);
      }
      await sb.schema("aria_internal").from("autonomy_goals").update({
        status:m?.status==="succeeded"?"completed":(m?.status==="failed"||m?.status==="blocked"?"queued":"running"),
        updated_at:new Date().toISOString()
      }).eq("goal_id",selected.goal_id);
      await sb.schema("aria_internal").from("autonomy_cycles").update({
        status:m?.status==="succeeded"?"completed":(m?.status==="paused"||m?.status==="waiting"?"waiting":"processed"),
        active_missions_count:activeCount,
        goals_scanned:snap.goals.length,failures_scanned:snap.failures.length,
        capability_gaps_scanned:snap.capabilityGaps.length,learnings_scanned:snap.learnings.length,
        candidates_generated:generated.length,candidates_inserted:inserted,
        selected_goal_id:selected.goal_id,created_mission_id:mission.missionId,
        mission_status:m?.status??null,learning_result:learning??{},
        evidence:{recovery:recover.data??0,mission:m??null,run,gate:mission.gate},
        updated_at:new Date().toISOString()
      }).eq("cycle_id",id);
      return {ok:true,deduplicated:false,cycle_id:id,policy_version:"autonomy-post-plan-v1",active_missions_count:activeCount,selected_goal:selected,mission,run,learning,generated_candidates:generated.length,inserted_candidates:inserted};
    }
  }
  await sb.schema("aria_internal").from("autonomy_cycles").update({
    status:activeCount>0?"deferred":"idle",
    active_missions_count:activeCount,goals_scanned:snap.goals.length,failures_scanned:snap.failures.length,
    capability_gaps_scanned:snap.capabilityGaps.length,learnings_scanned:snap.learnings.length,
    candidates_generated:generated.length,candidates_inserted:inserted,
    evidence:{recovery:recover.data??0,reason:activeCount>0?"active_mission":"no_eligible_goal"},
    updated_at:new Date().toISOString()
  }).eq("cycle_id",id);
  return {ok:true,deduplicated:false,cycle_id:id,policy_version:"autonomy-post-plan-v1",active_missions_count:activeCount,selected_goal:null,mission:null,run:null,learning:null,generated_candidates:generated.length,inserted_candidates:inserted};
}

Deno.serve(async r=>{
  if(r.method!=="POST")return out({error:"method_not_allowed"},405);
  if(!(await auth(r)))return out({error:"unauthorized"},401);
  try{
    const b=await r.json().catch(()=>({}));
    return out(await cycle(b));
  }catch(e){
    return out({ok:false,status:"blocked",error:e instanceof Error?e.message:String(e),policy_version:"autonomy-post-plan-v1"},200);
  }
});
