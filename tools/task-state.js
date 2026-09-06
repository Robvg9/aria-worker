'use strict';
const STATES=Object.freeze(['submitted','working','input_required','completed','failed','cancelled']);
const TERMINAL=new Set(['completed','failed','cancelled']);
function transitionTask(task,state,patch={}){if(!task?.task_id)throw new Error('task_id_required');if(!STATES.includes(state))throw new Error('task_state_invalid');if(TERMINAL.has(task.status) && state!==task.status)throw new Error('terminal_task_immutable');return{...task,...patch,status:state,updated_at:new Date().toISOString()};}
module.exports={STATES,TERMINAL,transitionTask};
