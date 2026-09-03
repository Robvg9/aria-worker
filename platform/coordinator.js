'use strict';
const { validateExtensionContract }=require('./contract');
function createPlatformCoordinator({registry,lifecycle,marketplace,scheduler}={}){
 return {
  registerExtension(spec){const v=validateExtensionContract(spec); if(!v.valid)return v; return {ok:true,item:registry.register(spec)};},
  activate(id){const item=registry&&registry.get(id); if(!item)return {ok:false,reason:'not_found'}; return lifecycle.transition(item,'active');},
  publish(id,{verified=false}={}){const item=registry&&registry.get(id); if(!item)return {ok:false,reason:'not_found'}; return marketplace.publish(item,{verified});},
  schedule(job){return scheduler.schedule(job);},
  inspect(){return {items:registry?registry.list():[],published:marketplace?marketplace.list():[],schedules:scheduler?scheduler.list():[]};}
 };
}
module.exports={createPlatformCoordinator};