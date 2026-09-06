'use strict';
const COMMANDS=Object.freeze(new Set(['status','mission.create','mission.pause','mission.resume','mission.cancel','memory.search','system.audit']));
const RISK=Object.freeze({status:'read','memory.search':'read','system.audit':'read','mission.create':'low','mission.pause':'low','mission.resume':'low','mission.cancel':'medium'});
function normalizeCommand(input={}){if(!input.request_id||!input.command)throw new Error('command_required');const command=String(input.command).trim();if(!COMMANDS.has(command))throw new Error('command_not_supported');return{request_id:String(input.request_id),command,args:input.args&&typeof input.args==='object'?input.args:{},risk:RISK[command]};}
function requiresApproval(command){return RISK[command]==='medium'||RISK[command]==='high'||RISK[command]==='destructive';}
module.exports={COMMANDS,RISK,normalizeCommand,requiresApproval};
