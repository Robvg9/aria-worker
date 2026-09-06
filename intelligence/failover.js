'use strict';
function chooseFallback(candidates=[],failedKeys=[]){const failed=new Set(failedKeys.map(String));return candidates.filter(c=>c?.available===true&&!failed.has(String(c.key||c.account_id||c.model_id))).sort((a,b)=>(Number(b.reliability||0)-Number(a.reliability||0))||(String(a.key||a.model_id).localeCompare(String(b.key||b.model_id))))[0]||null;}
function recordFailure(history=[],key,reason){return[...history,{key:String(key),reason:String(reason||'unknown'),at:new Date().toISOString()}];}
module.exports={chooseFallback,recordFailure};
