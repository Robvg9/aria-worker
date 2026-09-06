'use strict';
const ACTIONS=Object.freeze(['navigate','click','type','keypress','scroll','screenshot','read']);
function createComputerAction({id,action,target=null,text=null,risk='low'}={}){if(!id||!ACTIONS.includes(action))throw new Error('computer_action_invalid');if(action==='type'&&!text)throw new Error('text_required');return Object.freeze({id,action,target,text,risk});}
function validateComputerResult(result={}){if(!result?.action_id) return{valid:false,reason:'action_id_required'};if(!['succeeded','failed','blocked'].includes(result.status))return{valid:false,reason:'result_status_invalid'};return{valid:true};}
module.exports={ACTIONS,createComputerAction,validateComputerResult};
