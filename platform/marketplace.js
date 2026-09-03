'use strict';
function createMarketplace(registry){
  const catalog=new Map();
  return {
    publish(item,{verified=false}={}){
      if(!registry||!item||!item.id||verified!==true) return {ok:false,reason:'verification_required'};
      const registered=registry.get(item.id); if(!registered) return {ok:false,reason:'not_registered'};
      catalog.set(item.id,{...registered,published:true}); return {ok:true,item:{...catalog.get(item.id)}};
    },
    unpublish(id){ return catalog.delete(id); },
    list(){ return [...catalog.values()].map(x=>({...x})); },
    get(id){ const x=catalog.get(id); return x?{...x}:null; }
  };
}
module.exports={createMarketplace};