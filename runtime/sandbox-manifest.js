'use strict';
function createManifest({workspace='workspace',inputs=[],outputs=['artifacts'],tools=[],network='deny',limits={}}={}){if(!workspace||typeof workspace!=='string')throw new Error('workspace_required');return Object.freeze({version:1,workspace,inputs:[...inputs],outputs:[...outputs],tools:[...new Set(tools)],network,limits:{...limits}});}
function validateManifest(m){if(!m||m.version!==1)return{valid:false,reason:'manifest_version_invalid'};if(m.network!=='deny'&&m.network!=='allowlist')return{valid:false,reason:'network_policy_invalid'};if(!Array.isArray(m.outputs)||m.outputs.length===0)return{valid:false,reason:'outputs_required'};return{valid:true};}
module.exports={createManifest,validateManifest};
