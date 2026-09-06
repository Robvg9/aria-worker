'use strict';
function createNodeIdentity({node_id,name,url,public_key_ref=null,capabilities=[],status='unknown'}={}){if(!node_id||!name||!url)throw new Error('node_identity_required');return Object.freeze({protocol:'ARIA-FEDERATION',version:'1.0.0',node_id,name,url,public_key_ref,capabilities:[...new Set(capabilities)],status});}
function canDelegate(node,capability){return node?.status==='available'&&Array.isArray(node.capabilities)&&node.capabilities.includes(capability);}
function createDelegationEnvelope({correlation_id,source_node,target_node,capability,task_ref}={}){if(!correlation_id||!source_node||!target_node||!capability||!task_ref)throw new Error('federation_envelope_invalid');return{version:1,correlation_id,source_node,target_node,capability,task_ref};}
module.exports={createNodeIdentity,canDelegate,createDelegationEnvelope};
