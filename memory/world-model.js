'use strict';
function upsertEntity(entities=[],entity){if(!entity?.id)throw new Error('entity_id_required');const i=entities.findIndex(e=>e.id===entity.id);if(i<0)return[...entities,{...entity}];const out=[...entities];out[i]={...out[i],...entity};return out;}
function addRelation(relations=[],relation){if(!relation?.from||!relation?.to||!relation?.type)throw new Error('relation_invalid');if(relations.some(r=>r.from===relation.from&&r.to===relation.to&&r.type===relation.type))return relations;return[...relations,{...relation}];}
function activeAt(item,at=new Date().toISOString()){const t=Date.parse(at);const start=item.valid_from?Date.parse(item.valid_from):-Infinity;const end=item.valid_until?Date.parse(item.valid_until):Infinity;return t>=start&&t<end;}
function contradictions(items=[]){const groups=new Map();for(const x of items){const k=String(x.subject||x.title||'').toLowerCase();if(!k)continue;(groups.get(k)||groups.set(k,[]).get(k)).push(x);}return[...groups.entries()].flatMap(([subject,xs])=>{const values=new Set(xs.map(x=>String(x.content||'')));return values.size>1?[{subject,items:xs}]:[]});}
module.exports={upsertEntity,addRelation,activeAt,contradictions};
