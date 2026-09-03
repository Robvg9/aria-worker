'use strict';
function discover(registry,{type,capability,status='available'}={}){
  if(!registry) return [];
  return registry.list(type).filter(x=>(!status||x.status===status)&&(!capability||x.capabilities.includes(capability)));
}
function capabilities(registry){ const out=new Set(); for(const x of registry.list()) for(const c of x.capabilities) out.add(c); return [...out].sort(); }
module.exports={discover,capabilities};