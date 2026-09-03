'use strict';

const { request } = require('./http');

function authHeaders(secret, kind='bearer') {
  if (!secret) return {};
  if (kind === 'notion') return { Authorization:`Bearer ${secret}`, 'Notion-Version':'2026-03-11' };
  if (kind === 'github') return { Authorization:`Bearer ${secret}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2026-03-10' };
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
    if(op==='file_read') return request({url:`${base}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='file_write') return request({url:`${base}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path}`,method:'PUT',headers:{...h,'Content-Type':'application/json'},body:{message:c.message,content:c.content,sha:c.sha,branch:c.branch,committer:c.committer,author:c.author},fetchImpl:c.fetchImpl});
    if(op==='branch_create') return request({url:`${base}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/git/refs`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{ref:`refs/heads/${c.branch}`,sha:c.sha},fetchImpl:c.fetchImpl});
    if(op==='pull_request') return request({url:`${base}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/pulls`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{title:c.title,head:c.head,base:c.base,body:c.body,draft:c.draft,maintainer_can_modify:c.maintainer_can_modify},fetchImpl:c.fetchImpl});
    if(op==='workflow_dispatch') return request({url:`${base}/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/actions/workflows/${c.workflow_id}/dispatches`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{ref:c.ref||'main',inputs:c.inputs||{}},fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  supabase: createAdapter({connector_id:'supabase', operations:['project_read','db_read','migration','logs','edge_function']}, async (op,c) => {
    const base=c.base_url||'https://api.supabase.com'; const h=authHeaders(c.secret); const ref=encodeURIComponent(c.project_ref||'');
    if(op==='health') return request({url:`${base}/v1/projects`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='project_read') return request({url:`${base}/v1/projects/${ref}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='db_read') return request({url:`${base}/v1/projects/${ref}/database/query/read-only`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query,parameters:c.parameters},fetchImpl:c.fetchImpl});
    if(op==='migration') return request({url:`${base}/v1/projects/${ref}/database/migrations`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query,name:c.name,rollback:c.rollback},fetchImpl:c.fetchImpl});
    if(op==='logs') return request({url:`${base}/v1/projects/${ref}/analytics/endpoints/logs${c.query_params||''}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='edge_function') return request({url:`${base}/v1/projects/${ref}/functions/deploy${c.slug?`?slug=${encodeURIComponent(c.slug)}`:''}`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{file:c.file,metadata:c.metadata},fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  cloudflare: createAdapter({connector_id:'cloudflare', operations:['account_read','worker_read','deployments_read','deployment_create','worker_write','logs']}, async (op,c) => {
    const base=c.base_url||'https://api.cloudflare.com/client/v4'; const h=authHeaders(c.secret); const account=encodeURIComponent(c.account_id||''); const script=encodeURIComponent(c.script_name||'');
    if(op==='health') return request({url:`${base}/accounts/${account}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='account_read') return request({url:`${base}/accounts/${account}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='worker_read') return request({url:`${base}/accounts/${account}/workers/scripts/${script}/content/v2`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='deployments_read') return request({url:`${base}/accounts/${account}/workers/scripts/${script}/deployments`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='worker_write') return request({url:`${base}/accounts/${account}/workers/scripts/${script}/content`,method:'PUT',headers:{...h,'Content-Type':c.content_type||'application/javascript'},body:c.content,fetchImpl:c.fetchImpl});
    if(op==='deployment_create') return request({url:`${base}/accounts/${account}/workers/scripts/${script}/deployments`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{strategy:c.strategy||'percentage',versions:c.versions,annotations:c.annotations},fetchImpl:c.fetchImpl});
    if(op==='logs') return request({url:`${base}/accounts/${account}/workers/scripts/${script}/tails`,headers:h,fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  notion: createAdapter({connector_id:'notion', operations:['search','page_read','page_write']}, async (op,c) => {
    const base=c.base_url||'https://api.notion.com/v1'; const h=authHeaders(c.secret,'notion');
    if(op==='health') return request({url:`${base}/users/me`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='search') return request({url:`${base}/search`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query||'',filter:c.filter,sort:c.sort},fetchImpl:c.fetchImpl});
    if(op==='page_read') return request({url:`${base}/pages/${encodeURIComponent(c.page_id)}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='page_write') return request({url:`${base}/pages/${encodeURIComponent(c.page_id)}/markdown`,method:'PATCH',headers:{...h,'Content-Type':'application/json'},body:c.update_content||c.markdown_update,fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  web: createAdapter({connector_id:'web', operations:['fetch']}, async (op,c) => op==='health' ? {ok:true,status:200,data:{status:'ready'}} : request({url:c.url,method:c.method||'GET',headers:c.headers||{},body:c.body,fetchImpl:c.fetchImpl})),
  filesystem: createAdapter({connector_id:'filesystem', operations:['read','write','list']}, async (op,c) => {
    if(op==='health') return {ok:true,status:200,data:{status:'ready'}};
    if(typeof c.hostRuntime !== 'object' || c.hostRuntime === null) return {ok:false,status:503,data:{error:'filesystem_host_runtime_required'}};
    if(typeof c.hostRuntime[op] !== 'function') return {ok:false,status:501,data:{error:'filesystem_operation_not_bound'}};
    const value=await c.hostRuntime[op](c); return {ok:true,status:200,data:value};
  }),
  image: createAdapter({connector_id:'image', operations:['generate','edit']}, async (op,c) => {
    if(typeof c.providerRuntime !== 'object' || c.providerRuntime === null || typeof c.providerRuntime[op] !== 'function') return {ok:false,status:503,data:{error:'image_provider_runtime_required'}};
    const value=await c.providerRuntime[op](c); return {ok:true,status:200,data:value};
  })
};

module.exports = { adapters, authHeaders };
