'use strict';
const STAGES=Object.freeze(['gap_analysis','research','design','implementation','sandbox_test','security','evaluation','review','deploy','observe','learn']);
function createCapabilityFactoryPlan({capability,reason=null,risk='medium'}={}){if(!capability||typeof capability!=='string')throw new Error('capability_required');return{type:'capability_factory',capability,reason,risk,stages:[...STAGES],human_gate_required:risk==='high'||risk==='destructive'};}
function nextFactoryStage(plan,current){const i=plan?.stages?.indexOf(current);return i<0||i+1>=plan.stages.length?null:plan.stages[i+1];}
module.exports={STAGES,createCapabilityFactoryPlan,nextFactoryStage};
