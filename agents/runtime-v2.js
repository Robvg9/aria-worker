'use strict';

const { buildPlan, shouldStop, finalizeDecision } = require('./manager-v2');

async function mapWithLimit(items, limit, worker){
  const results=new Array(items.length);
  let cursor=0;
  async function lane(){
    while(true){
      const i=cursor++;
      if(i>=items.length) return;
      results[i]=await worker(items[i],i);
    }
  }
  const lanes=Math.max(1,Math.min(limit,items.length||1));
  await Promise.all(Array.from({length:lanes},()=>lane()));
  return results;
}

function createMultiAgentRuntime({agents=[],executors={},verifier=null,learning=null,budget=10,maxSteps=20,maxAgents=3,maxParallel=2,requireConsensus=false,maxAttempts=1}={}){
  return Object.freeze({
    async run({goal,tasks=[],requiredCapabilities=[],budget:runBudget,requireConsensus:runConsensus,maxAttempts:runMaxAttempts}={}){
      const budgetValue=runBudget??budget;
      const consensusRequired=runConsensus??requireConsensus;
      const attemptLimit=Math.max(1,runMaxAttempts??maxAttempts);
      const plan=buildPlan({goal,tasks,agents,budget:budgetValue,maxSteps,maxAgents,maxParallel,requiredCapabilities});
      if(plan.status!=='planned') return {status:'blocked',reason:plan.reason,plan};
      if(plan.tasks.some(t=>t.requireHumanGate)) return {status:'blocked',reason:'human_gate_required',plan,results:[],budgetUsed:0};

      const selectedById=new Map(plan.agents.map(a=>[a.id,a]));
      let budgetUsed=0;
      const allResults=[];
      const executeTask=async(task,index)=>{
        const requestedId=task.assignedAgentId||null;
        const firstAgent=requestedId?selectedById.get(requestedId):plan.agents[index%plan.agents.length];
        const ordered=[firstAgent,...plan.agents.filter(a=>a.id!==firstAgent?.id)];
        const attempted=[];
        for(let attempt=0;attempt<attemptLimit;attempt++){
          const agent=ordered[attempt];
          if(!agent||attempted.includes(agent.id)) break;
          attempted.push(agent.id);
          const executor=executors[agent.id];
          if(typeof executor!=='function'){
            allResults.push({agentId:agent.id,taskId:task.id,status:'failed',claim:'executor_missing',attempt:attempt+1});
            continue;
          }
          const result=await executor({agent,task,goal,planHash:plan.planHash,attempt:attempt+1,attemptedAgents:[...attempted]});
          budgetUsed+=Number(task.cost)||1;
          const enriched={...result,agentId:agent.id,taskId:task.id,attempt:attempt+1,attemptedAgents:[...attempted]};
          allResults.push(enriched);
          if(enriched.status==='succeeded') return enriched;
          if(attempt+1>=attemptLimit||budgetUsed>=budgetValue) return enriched;
        }
        return allResults[allResults.length-1]||{taskId:task.id,status:'failed',claim:'no_agent_available'};
      };

      let results;
      if(plan.mode==='parallel'){
        results=await mapWithLimit(plan.tasks,plan.maxParallel,executeTask);
      }else{
        results=[];
        for(let i=0;i<plan.tasks.length;i++){
          const result=await executeTask(plan.tasks[i],i);
          results.push(result);
          const stop=shouldStop({results,budgetUsed,budget:budgetValue,step:i+1,maxSteps,requireHumanGate:false});
          if(stop.stop&&stop.reason!=='consensus') break;
        }
      }

      const decision=finalizeDecision({results,verifier,requireConsensus:consensusRequired});
      if(decision.verified&&typeof learning==='function') await learning({goal,plan,results,decision});
      return {status:decision.status,plan,results,attempts:allResults,budgetUsed,decision};
    }
  });
}

module.exports={mapWithLimit,createMultiAgentRuntime};
