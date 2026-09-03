'use strict';
const STATES = new Set(['installed','active','inactive','blocked','failed','removed']);
const TRANSITIONS = { installed:['active','inactive','removed'], active:['inactive','blocked','failed'], inactive:['active','removed'], blocked:['active','removed'], failed:['inactive','active','removed'], removed:[] };
function transition(item, next){
  if(!item||!STATES.has(item.status)||!STATES.has(next)) return {ok:false,reason:'invalid_state'};
  if(!TRANSITIONS[item.status].includes(next)) return {ok:false,reason:'invalid_transition'};
  return {ok:true,item:{...item,status:next}};
}
function createLifecycle(){ return {transition}; }
module.exports={STATES,TRANSITIONS,transition,createLifecycle};