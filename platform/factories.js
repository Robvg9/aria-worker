'use strict';
const { validateExtensionContract } = require('./contract');
const SECRET = /(api[_-]?key|password|authorization|bearer\s+|access[_-]?token|refresh[_-]?token|secret\b)/i;
function build(type, spec, registry){
  if(!registry) return {ok:false,reason:'registry_missing'};
  const check=validateExtensionContract({...spec,type});
  if(!check.valid) return {ok:false,reason:check.reason};
  if(typeof spec.id!=='string'||typeof spec.name!=='string') return {ok:false,reason:'identity_required'};
  if(SECRET.test(JSON.stringify(spec))) return {ok:false,reason:'sensitive_definition'};
  return {ok:true,item:registry.register({...spec,type,status:spec.status||'unknown'})};
}
function createTool(spec,registry){ return build('tool',spec,registry); }
function createAgent(spec,registry){ return build('agent',spec,registry); }
function createConnector(spec,registry){ return build('connector',spec,registry); }
function createPlugin(spec,registry){ return build('plugin',spec,registry); }
module.exports={createTool,createAgent,createConnector,createPlugin};