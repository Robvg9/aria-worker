'use strict';
const TRIGGERS=Object.freeze(['schedule','event','goal','failure','learning','security','opportunity']);
function createTrigger({id,type,condition,goal_template,enabled=true}={}){if(!id||!TRIGGERS.includes(type)||!goal_template)throw new Error('trigger_invalid');return Object.freeze({id,type,condition:condition||null,goal_template,enabled});}
function shouldFire(trigger,event={}){if(!trigger?.enabled)return false;if(trigger.condition==null)return true;if(typeof trigger.condition==='function')return Boolean(trigger.condition(event));return false;}
module.exports={TRIGGERS,createTrigger,shouldFire};
