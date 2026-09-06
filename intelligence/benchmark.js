'use strict';
function scoreBenchmark({quality=0,reliability=0,latency=0,cost=0}={},weights={quality:.45,reliability:.25,latency:.15,cost:.15}){
 const q=Math.max(0,Math.min(1,Number(quality)));const r=Math.max(0,Math.min(1,Number(reliability)));const l=Math.max(0,Math.min(1,Number(latency)));const c=Math.max(0,Math.min(1,Number(cost)));return Number((q*weights.quality+r*weights.reliability+(1-l)*weights.latency+(1-c)*weights.cost).toFixed(6));
}
function rankModels(results=[],weights){return results.map(x=>({...x,utility:scoreBenchmark(x,weights)})).sort((a,b)=>b.utility-a.utility||String(a.model_id).localeCompare(String(b.model_id)))}
function chooseModel(results=[],constraints={}){const eligible=results.filter(x=>!constraints.capability||Array.isArray(x.capabilities)&&x.capabilities.includes(constraints.capability));return rankModels(eligible,constraints.weights)[0]||null}
module.exports={scoreBenchmark,rankModels,chooseModel};
