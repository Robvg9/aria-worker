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

function createMultiAgentRuntime({agents=[],executors={},verifier=null,budget=10,maxSteps=20,maxAgents=3,maxParallel=2,requireConsensus=false}={}){
  return Object.freeze({
    async run({goal,tasks=[],requiredCapabilities=[],budget:runBudget,requireConsensus:runConsensus}={}){
      const budgetValue=runBudget??budget;
      const consensusRequired=runConsensus??requireConsensus;
      const plan=buildPlan({goal,tasks,agents,budget:budgetValue,maxSteps,maxAgents,maxParallel,requiredCapabilities});
      if(plan.status!=='planned') return {status:'blocked',reason:plan.reason,plan};
      let budgetUsed=0;
      let results=[];
      const executeTask=async (task,index)=>{
        const agent=plan.agents[index%plan.agents.length];
        const executor=executors[agent.id];
        if(typeof executor!=='function') return {agentId:agent.id,taskId:task.id,status:'failed',claim:'executor_missing'};
        const result=await executor({agent,task,goal,planHash:plan.planHash});
        return {...result,agentId:agent.id,taskId:task.id};
      };
      if(plan.mode==='parallel') results=await mapWithLimit(plan.tasks,plan.maxParallel,executeTask);
      else for(let i=0;i<plan.tasks.length;i++){
        results.push(await executeTask(plan.tasks[i],i));
        budgetUsed += Number(plan.tasks[i].cost)||1;
        const stop=shouldStop({results,budgetUsed,budget:budgetValue,step:i+1,maxSteps,requireHumanGate:Boolean(plan.tasks[i].requireHumanGate)});
        if(stop.stop) break;
      }
      if(plan.mode==='parallel') budgetUsed=plan.tasks.reduce((n,t)=>n+(Number(t.cost)||1),0);
      const decision=finalizeDecision({results,verifier,requireConsensus:consensusRequired});
      return {status:decision.status,plan,results,budgetUsed,decision};
    }
  });
}

module.exports={mapWithLimit,createMultiAgentRuntime};
