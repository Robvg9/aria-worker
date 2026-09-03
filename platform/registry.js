'use strict';
const TYPES = new Set(['plugin','connector','tool','agent','capability','schedule']);
const STATUSES = new Set(['available','inactive','blocked','unknown']);
function createPlatformRegistry() {
  const map = new Map();
  return {
    register(item) {
      if (!item || typeof item.id !== 'string' || !item.id || !TYPES.has(item.type)) throw new Error('invalid platform item');
      const safe = Object.freeze({ id:item.id, type:item.type, name:typeof item.name==='string'?item.name:item.id, version:typeof item.version==='string'?item.version:'0.0.0', status:STATUSES.has(item.status)?item.status:'unknown', capabilities:Array.isArray(item.capabilities)?[...new Set(item.capabilities)]:[], metadata:item.metadata&&typeof item.metadata==='object'?{...item.metadata}:{} });
      map.set(safe.id,safe); return safe;
    },
    get(id){ return map.get(id)||null; },
    list(type){ return [...map.values()].filter(x=>!type||x.type===type).map(x=>({...x,capabilities:[...x.capabilities],metadata:{...x.metadata}})); },
    available(id){ const x=map.get(id); return !!x&&x.status==='available'; }
  };
}
module.exports={createPlatformRegistry,TYPES,STATUSES};