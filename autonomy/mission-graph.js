'use strict';

function validateGraph(steps = []) {
  const ids = new Set();
  for (const step of steps) {
    if (!step?.id || ids.has(step.id)) return { valid: false, reason: 'duplicate_or_missing_step_id' };
    ids.add(step.id);
    for (const dep of step.depends_on || []) if (dep === step.id || !steps.some(x => x?.id === dep)) return { valid: false, reason: 'dependency_missing_or_self', step_id: step.id, dependency: dep };
  }
  const state = new Map(steps.map(s => [s.id, 0]));
  const visit = id => { const s = state.get(id); if (s === 1) return false; if (s === 2) return true; state.set(id,1); const step=steps.find(x=>x.id===id); for(const dep of step?.depends_on||[]) if(!visit(dep)) return false; state.set(id,2); return true; };
  for (const step of steps) if (!visit(step.id)) return { valid:false, reason:'dependency_cycle' };
  return { valid:true };
}
function readySteps(steps = [], completed = []) { const done = new Set(completed.map(String)); return steps.filter(step => !done.has(String(step.id)) && (step.depends_on || []).every(dep => done.has(String(dep)))); }
function topologicalBatches(steps = []) { const check=validateGraph(steps);if(!check.valid)throw new Error(check.reason);const remaining=new Set(steps.map(s=>s.id)),batches=[];while(remaining.size){const done=new Set(steps.filter(s=>!remaining.has(s.id)).map(s=>s.id));const batch=steps.filter(s=>remaining.has(s.id)&&(s.depends_on||[]).every(d=>done.has(d))).map(s=>s.id);if(!batch.length)throw new Error('dependency_cycle');batches.push(batch);batch.forEach(id=>remaining.delete(id));}return batches; }
module.exports={validateGraph,readySteps,topologicalBatches};
