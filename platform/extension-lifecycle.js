'use strict';
const STATES=Object.freeze(['discovered','validated','installed','enabled','disabled','failed','rolled_back']);
function transitionExtension(ext,state,{tests_passed=false,security_passed=false}={}){if(!ext?.id)throw new Error('extension_id_required');if(!STATES.includes(state))throw new Error('extension_state_invalid');if(state==='enabled'&&(!tests_passed||!security_passed))throw new Error('extension_enable_requires_verification');if(state==='rolled_back'&&ext.state!=='enabled'&&ext.state!=='failed')throw new Error('rollback_state_invalid');return{...ext,state,updated_at:new Date().toISOString()};}
function upgradePlan({from,to,rollback=true}={}){if(!from||!to)throw new Error('version_required');return{from,to,steps:['snapshot','validate','install','test','security','enable'],rollback};}
module.exports={STATES,transitionExtension,upgradePlan};
