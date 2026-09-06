'use strict';
function normalizeCandidate(c={}){return{...c,quality:Math.max(0,Math.min(1,Number(c.quality??0))),reliability:Math.max(0,Math.min(1,Number(c.reliability??0))),latency_ms:Math.max(0,Number(c.latency_ms??0)),usd_per_1k:Number(c.usd_per_1k??0)}}
function utility(c,{qualityWeight=.45,reliabilityWeight=.3,latencyWeight=.1,costWeight=.15}={}){const x=normalizeCandidate(c);const latency=1/(1+x.latency_ms/1000);const cost=x.usd_per_1k<=0?1:1/(1+x.usd_per_1k);return Number((x.quality*qualityWeight+x.reliability*reliabilityWeight+latency*latencyWeight+cost*costWeight).toFixed(6));}
function optimize(candidates=[],options){return candidates.map(c=>({...c,utility:utility(c,options)})).sort((a,b)=>b.utility-a.utility||String(a.model_id).localeCompare(String(b.model_id)))[0]||null;}
module.exports={normalizeCandidate,utility,optimize};
