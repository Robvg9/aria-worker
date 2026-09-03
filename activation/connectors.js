'use strict';

const { request } = require('./http');

function authHeaders(secret, kind='bearer') {
  if (!secret) return {};
  if (kind === 'notion') return { Authorization:`Bearer ${secret}`, 'Notion-Version':'2025-09-03' };
  if (kind === 'github') return { Authorization:`Bearer ${secret}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28' };
  return { Authorization:`Bearer ${secret}` };
}

function createAdapter(descriptor, call) {
  return Object.freeze({ descriptor, async health(ctx={}) { return call('health',ctx); }, async execute(operation,ctx={}) { return call(operation,ctx); } });
}

const adapters = {
  github: createAdapter({connector_id:'github', operations:['repo_read','file_read','file_write','branch_create','pull_request','workflow_dispatch']}, async (op,c) => {
    const base=c.base_url||'https://api.github.com'; const h=authHeaders(c.secret,'github');
    if(op==='health') return request({url:`${base}/rate_limit`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='repo_read') return request({url:`${base}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='file_read') return request({url:`${base}/repos/${c.owner}/${c.repo}/contents/${c.path}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='workflow_dispatch') return request({url:`${base}/repos/${c.owner}/${c.repo}/actions/workflows/${c.workflow_id}/dispatches`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{ref:c.ref||'main',inputs:c.inputs||{}},fetchImpl:c.fetchImpl});
    return {ok:false,status:501,data:{error:'write_operation_requires_explicit_adapter_contract'}};
  }),
  supabase: createAdapter({connector_id:'supabase', operations:['project_read','db_read','migration','logs','edge_function']}, async (op,c) => {
    const base=c.base_url||'https://api.supabase.com'; const h=authHeaders(c.secret);
    if(op==='health') return request({url:`${base}/v1/projects`,headers:h,fetchImpl:c.fetchImpl});
    const ref=encodeURIComponent(c.project_ref||'');
    if(op==='project_read') return request({url:`${base}/v1/projects/${ref}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='migration') return request({url:`${base}/v1/projects/${ref}/database/migrations`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query,name:c.name,rollback:c.rollback},fetchImpl:c.fetchImpl});
    if(op==='logs') return request({url:`${base}/v1/projects/${ref}/analytics/endpoints/logs${c.query_params||''}`,headers:h,fetchImpl:c.fetchImpl});
    return {ok:false,status:501,data:{error:'operation_requires_project_specific_contract'}};
  }),
  cloudflare: createAdapter({connector_id:'cloudflare', operations:['account_read','worker_read','deployments_read','deployment_create','logs']}, async (op,c) => {
    const base=c.base_url||'https://api.cloudflare.com/client/v4'; const h=authHeaders(c.secret); const account=encodeURIComponent(c.account_id||''); const script=encodeURIComponent(c.script_name||'');
    if(op==='health') return request({url:`${base}/accounts/${account}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='account_read') return request({url:`${base}/accounts/${account}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='worker_read') return request({url:`${base}/accounts/${account}/workers/scripts/${script}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='deployments_read') return request({url:`${base}/accounts/${account}/workers/scripts/${script}/deployments`,headers:h,fetchImpl:c.fetchImpl});
    return {ok:false,status:501,data:{error:'deployment_upload_requires_version_payload'}};
  }),
  notion: createAdapter({connector_id:'notion', operations:['search','page_read','page_write']}, async (op,c) => {
    const base=c.base_url||'https://api.notion.com/v1'; const h=authHeaders(c.secret,'notion');
    if(op==='health') return request({url:`${base}/users/me`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='search') return request({url:`${base}/search`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query||''},fetchImpl:c.fetchImpl});
    if(op==='page_read') return request({url:`${base}/pages/${c.page_id}`,headers:h,fetchImpl:c.fetchImpl});
    return {ok:false,status:501,data:{error:'page_write_requires_explicit_content_contract'}};
  }),
  web: createAdapter({connector_id:'web', operations:['fetch']}, async (op,c) => op==='health' ? {ok:true,status:200,data:{status:'ready'}} : request({url:c.url,method:c.method||'GET',headers:c.headers||{},body:c.body,fetchImpl:c.fetchImpl})),
  filesystem: createAdapter({connector_id:'filesystem', operations:['read','write','list']}, async (op,c) => {
    if(op==='health') return {ok:true,status:200,data:{status:'ready'}};
    if(op==='list') return {ok:true,status:200,data:{path:c.path||'.',note:'filesystem execution is supplied by the host runtime'}};
    return {ok:false,status:501,data:{error:'filesystem_write_boundary_requires_host_runtime'}};
  }),
  image: createAdapter({connector_id:'image', operations:['generate','edit']}, async () => ({ok:false,status:501,data:{error:'image_runtime_is_external_provider_adapter'}}))
};

module.exports = { adapters, authHeaders };
