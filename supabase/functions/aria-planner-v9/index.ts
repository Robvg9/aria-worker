import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const URL=Deno.env.get("SUPABASE_URL")!,KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,SHARED=Deno.env.get("ARIA_RUNTIME_SHARED_SECRET")!;
const sb=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{"content-type":"application/json","cache-control":"no-store"}});
const eq=(a:string,b:string)=>{const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);if(x.length!==y.length)return false;let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0};
const bearer=(r:Request)=>{const h=r.headers.get("authorization")??"";return h.startsWith("Bearer ")?h.slice(7):null};
async function auth(r:Request){const t=bearer(r);if(t&&SHARED&&eq(t,SHARED))return true;const c=r.headers.get("x-aria-autonomy-token");if(!c)return false;const {data,error}=await sb.rpc("aria_autonomy_cron_authorize",{p_token:c});return !error&&data===true}
const step=(i:number,operation:string,path:string,connector="github")=>({id:`auto_${i}`,operation,executor_type:"connector",target:{type:"connector",connector_id:connector,device_id:null},input:{owner:"Robvg9",repo:"aria-worker",path,ref:"main"},risk:"READ",cwd:null,timeout_ms:30000});
function fixed(g:string){const s=g.toLowerCase();if(s.includes("multiia")||s.includes("multi-ia"))return [step(1,"file_read","multi-ia/registry.js"),step(2,"file_read","multi-ia/router.js"),step(3,"file_read","tests/block-7-multi-ia.test.js")];if(s.includes("memory")||s.includes("chatbending"))return [step(1,"file_read","memory/repository.js"),step(2,"file_read","memory/retrieval.js"),step(3,"file_read","tests/mission-state.test.js")];if(s.includes("selfdevelopment")||s.includes("self-development"))return [step(1,"file_read","self-development/coordinator.js"),step(2,"file_read","self-development/tester.js"),step(3,"file_read","tests/block-5-self-development.test.js")];if(s.includes("orchestration"))return [step(1,"file_read","execution/orchestrator.js"),step(2,"file_read","autonomy/coordinator.js"),step(3,"file_read","tests/block-6-autonomy.test.js")];if(s.includes("interface"))return [step(1,"file_read","activation/runtime.js"),step(2,"file_read","worker.js"),step(3,"file_read","tests/real-activation.test.js")];if(s.includes("health audit")||s.includes("executors"))return [step(1,"file_read","worker.js"),{...step(2,"account_read","", "cloudflare"),input:{script_name:"aria"}}];return null}

function attachCognitiveContext(plan:any, context:any){
  const memories=Array.isArray(context?.recalled_memories)?context.recalled_memories.slice(0,8):[];
  return {
    ...plan,
    cognitive_context:{
      version:"cognitive-loop-v2",
      recall_count:memories.length,
      memory_ids:memories.map((m:any)=>m.memory_id||m.id).filter(Boolean),
      confidence_summary:memories.map((m:any)=>m.confidence).filter((v:any)=>typeof v==="number")
    }
  };
}

Deno.serve(async r=>{
  if(r.method!=="POST")return json({error:"method_not_allowed"},405);
  if(!(await auth(r)))return json({error:"unauthorized"},401);
  const b=await r.json().catch(()=>({})),goal=typeof b.goal==="string"?b.goal.trim():"";
  if(!goal)return json({error:"goal_required"},400);
  const context=b.context&&typeof b.context==="object"&&!Array.isArray(b.context)?b.context:{};
  try{
    const p=fixed(goal);
    if(p)return json({ok:true,plan:attachCognitiveContext({goal,steps:p,model_id:"deterministic",planner_version:"aria-planner-v9.2"},context)});
    const ls=await sb.schema("aria_internal").from("autonomy_learnings").select("category,summary,confidence,created_at").eq("reusable",true).order("created_at",{ascending:false}).limit(8);
    return json({ok:true,plan:attachCognitiveContext({goal,steps:[step(1,"file_read","README.md")],model_id:"deterministic-fallback",planner_version:"aria-planner-v9.2",learning_context:ls.data??[]},context)});
  }catch(e){return json({error:e instanceof Error?e.message:"planner_failed"},502)}
});
