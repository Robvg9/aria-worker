'use strict';
function registerPlugin(registry=[],plugin={}){if(!plugin.id||!plugin.version)throw new Error('plugin_identity_required');if(registry.some(p=>p.id===plugin.id))throw new Error('plugin_exists');return[...registry,{...plugin,state:'discovered'}];}
function enablePlugin(registry=[],id,evidence={}){const p=registry.find(x=>x.id===id);if(!p)throw new Error('plugin_not_found');if(evidence.tests_passed!==true||evidence.security_passed!==true)throw new Error('plugin_verification_required');return registry.map(x=>x.id===id?{...x,state:'enabled'}:x);}
function disablePlugin(registry=[],id){return registry.map(x=>x.id===id?{...x,state:'disabled'}:x);}
module.exports={registerPlugin,enablePlugin,disablePlugin};
