'use strict';
function createMaintenance({inspect,repair,test,document}={}){
 return {async run(input={}){
  if(typeof inspect!=='function') return {status:'blocked',reason:'inspection_unavailable'};
  const before=await inspect(input); let repairResult=null;
  if(before&&before.healthy===false&&typeof repair==='function') repairResult=await repair(before,input);
  const tested=typeof test==='function'?await test(input,repairResult):null;
  const healthy=tested===null?!(repairResult&&repairResult.failed===true):tested===true;
  const record={status:healthy?'verified':'blocked',before,repair:repairResult,tested};
  if(typeof document==='function') record.documentation=await document(record);
  return record;
 }};
}
module.exports={createMaintenance};