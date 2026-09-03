'use strict';
function createScheduler(){
 const jobs=new Map();
 return {
  schedule(job){
   if(!job||typeof job.id!=='string'||!job.id||typeof job.due_at!=='number'||!Number.isFinite(job.due_at)) return {ok:false,reason:'invalid_schedule'};
   const safe=Object.freeze({id:job.id,due_at:job.due_at,task_id:typeof job.task_id==='string'?job.task_id:null,status:'scheduled'}); jobs.set(safe.id,safe); return {ok:true,job:safe};
  },
  cancel(id){const j=jobs.get(id); if(!j) return false; jobs.set(id,Object.freeze({...j,status:'cancelled'})); return true;},
  due(now){if(typeof now!=='number'||!Number.isFinite(now)) return []; return [...jobs.values()].filter(j=>j.status==='scheduled'&&j.due_at<=now).sort((a,b)=>a.due_at-b.due_at||a.id.localeCompare(b.id));},
  list(){return [...jobs.values()].map(j=>({...j}));}
 };
}
module.exports={createScheduler};