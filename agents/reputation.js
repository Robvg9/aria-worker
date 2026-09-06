'use strict';
function updateReputation(previous=0.5,outcome='success',weight=1){const p=Math.max(0,Math.min(1,Number(previous)));const w=Math.max(0,Math.min(1,Number(weight)));const target=outcome==='success'?1:outcome==='failure'?0:p;return Number((p*(1-w)+target*w).toFixed(6));}
function rankAgents(agents=[]){return agents.map(a=>({...a,reputation:Math.max(0,Math.min(1,Number(a.reputation??0.5)))})).sort((a,b)=>b.reputation-a.reputation||String(a.id).localeCompare(String(b.id)));}
module.exports={updateReputation,rankAgents};
