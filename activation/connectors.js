'use strict';

const { request } = require('./http');

function authHeaders(secret, kind='bearer') {
  if (!secret) return {};
  if (kind === 'notion') return { Authorization:`Bearer ${secret}`, 'Notion-Version':'2026-03-11' };
  if (kind === 'github') return { Authorization:`Bearer ${secret}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2026-03-10' };
  return { Authorization:`Bearer ${secret}` };
}
function providerRequest(c, options) { return request({ ...options, redaction_secrets:c.secret ? [c.secret] : [] }); }
function createAdapter(descriptor, call) { return Object.freeze({ descriptor, async health(ctx={}) { return call('health',ctx); }, async execute(operation,ctx={}) { return call(operation,ctx); } }); }

const adapters = {
  github: createAdapter({connector_id:'github',operations:['repo_read','file_read','file_write','branch_create','pull_request','workflow_dispatch'],operation_risk:{repo_read:'READ',file_read:'READ',file_write:'LOW_RISK_WRITE',branch_create:'LOW_RISK_WRITE',pull_request:'LOW_RISK_WRITE',workflow_dispatch:'HIGH_RISK_WRITE'}}, async (op,c) => {
    const base=c.base_url||'https://api.github.com', h=authHeaders(c.secret,'github'), owner=encodeURIComponent(c.owner||''), repo=encodeURIComponent(c.repo||'');
    if(op==='health') return providerRequest(c,{url:`${base}/rate_limit`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='repo_read') return providerRequest(c,{url:`${base}/repos/${owner}/${repo}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='file_read') return providerRequest(c,{url:`${base}/repos/${owner}/${repo}/contents/${c.path}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='file_write') return providerRequest(c,{url:`${base}/repos/${owner}/${repo}/contents/${c.path}`,method:'PUT',headers:{...h,'Content-Type':'application/json'},body:{message:c.message,content:Buffer.from(String(c.content||''),'utf8').toString('base64'),sha:c.sha,branch:c.branch,committer:c.committer,author:c.author},fetchImpl:c.fetchImpl});
    if(op==='branch_create') return providerRequest(c,{url:`${base}/repos/${owner}/${repo}/git/refs`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{ref:`refs/heads/${c.branch}`,sha:c.sha},fetchImpl:c.fetchImpl});
    if(op==='pull_request') return providerRequest(c,{url:`${base}/repos/${owner}/${repo}/pulls`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{title:c.title,head:c.head,base:c.base,body:c.body,draft:c.draft,maintainer_can_modify:c.maintainer_can_modify},fetchImpl:c.fetchImpl});
    if(op==='workflow_dispatch') return providerRequest(c,{url:`${base}/repos/${owner}/${repo}/actions/workflows/${c.workflow_id}/dispatches`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{ref:c.ref||'main',inputs:c.inputs||{}},fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  supabase: createAdapter({connector_id:'supabase',operations:['project_read','db_read','migration','logs','edge_function'],operation_risk:{project_read:'READ',db_read:'READ',migration:'HIGH_RISK_WRITE',logs:'READ',edge_function:'HIGH_RISK_WRITE'}}, async (op,c) => {
    const base=c.base_url||'https://api.supabase.com', h=authHeaders(c.secret), ref=encodeURIComponent(c.project_ref||'');
    if(op==='health') return providerRequest(c,{url:`${base}/v1/projects`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='project_read') return providerRequest(c,{url:`${base}/v1/projects/${ref}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='db_read') return providerRequest(c,{url:`${base}/v1/projects/${ref}/database/query/read-only`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query,parameters:c.parameters},fetchImpl:c.fetchImpl});
    if(op==='migration') return providerRequest(c,{url:`${base}/v1/projects/${ref}/database/migrations`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query,name:c.name,rollback:c.rollback},fetchImpl:c.fetchImpl});
    if(op==='logs') return providerRequest(c,{url:`${base}/v1/projects/${ref}/analytics/endpoints/logs${c.query_params||''}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='edge_function') return providerRequest(c,{url:`${base}/v1/projects/${ref}/functions/deploy${c.slug?`?slug=${encodeURIComponent(c.slug)}`:''}`,method:'POST',headers:{...h},rawBody:c.form_data,fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  cloudflare: createAdapter({connector_id:'cloudflare',operations:['account_read','worker_read','deployments_read','deployment_create','worker_write','logs'],operation_risk:{account_read:'READ',worker_read:'READ',deployments_read:'READ',deployment_create:'HIGH_RISK_WRITE',worker_write:'HIGH_RISK_WRITE',logs:'READ'}}, async (op,c) => {
    const base=c.base_url||'https://api.cloudflare.com/client/v4', h=authHeaders(c.secret), account=encodeURIComponent(c.account_id||''), script=encodeURIComponent(c.script_name||'');
    if(op==='health') return providerRequest(c,{url:`${base}/accounts/${account}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='account_read') return providerRequest(c,{url:`${base}/accounts/${account}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='worker_read') return providerRequest(c,{url:`${base}/accounts/${account}/workers/scripts/${script}/content/v2`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='deployments_read') return providerRequest(c,{url:`${base}/accounts/${account}/workers/scripts/${script}/deployments`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='worker_write') return providerRequest(c,{url:`${base}/accounts/${account}/workers/scripts/${script}/content`,method:'PUT',headers:{...h,'Content-Type':c.content_type||'application/javascript'},rawBody:String(c.content||''),fetchImpl:c.fetchImpl});
    if(op==='deployment_create') return providerRequest(c,{url:`${base}/accounts/${account}/workers/scripts/${script}/deployments`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{strategy:c.strategy||'percentage',versions:c.versions,annotations:c.annotations},fetchImpl:c.fetchImpl});
    if(op==='logs') return providerRequest(c,{url:`${base}/accounts/${account}/workers/scripts/${script}/tails`,headers:h,fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  notion: createAdapter({connector_id:'notion',operations:['search','page_read','page_write'],operation_risk:{search:'READ',page_read:'READ',page_write:'LOW_RISK_WRITE'}}, async (op,c) => {
    const base=c.base_url||'https://api.notion.com/v1', h=authHeaders(c.secret,'notion');
    if(op==='health') return providerRequest(c,{url:`${base}/users/me`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='search') return providerRequest(c,{url:`${base}/search`,method:'POST',headers:{...h,'Content-Type':'application/json'},body:{query:c.query||'',filter:c.filter,sort:c.sort},fetchImpl:c.fetchImpl});
    if(op==='page_read') return providerRequest(c,{url:`${base}/pages/${encodeURIComponent(c.page_id)}`,headers:h,fetchImpl:c.fetchImpl});
    if(op==='page_write') return providerRequest(c,{url:`${base}/pages/${encodeURIComponent(c.page_id)}/markdown`,method:'PATCH',headers:{...h,'Content-Type':'application/json'},body:c.update_content||c.markdown_update,fetchImpl:c.fetchImpl});
    return {ok:false,status:400,data:{error:'unsupported_operation'}};
  }),
  web: createAdapter({connector_id:'web',operations:['fetch'],operation_risk:{fetch:'READ'}}, async (op,c) => op==='health' ? {ok:true,status:200,data:{status:'ready'}} : request({url:c.url,method:c.method||'GET',headers:c.headers||{},body:c.body,fetchImpl:c.fetchImpl})),
  filesystem: createAdapter({connector_id:'filesystem',operations:['read','write','list'],operation_risk:{read:'READ',write:'HIGH_RISK_WRITE',list:'READ'}}, async (op,c) => {
    if(op==='health') return {ok:true,status:200,data:{status:'ready'}};
    if(typeof c.hostRuntime !== 'object' || c.hostRuntime === null) return {ok:false,status:503,data:{error:'filesystem_host_runtime_required'}};
    if(typeof c.hostRuntime[op] !== 'function') return {ok:false,status:501,data:{error:'filesystem_operation_not_bound'}};
    const value=await c.hostRuntime[op](c); return {ok:true,status:200,data:value};
  }),
  image: createAdapter({connector_id:'image',operations:['generate','edit'],operation_risk:{generate:'LOW_RISK_WRITE',edit:'LOW_RISK_WRITE'}}, async (op,c) => {
    if(typeof c.providerRuntime !== 'object' || c.providerRuntime === null || typeof c.providerRuntime[op] !== 'function') return {ok:false,status:503,data:{error:'image_provider_runtime_required'}};
    const value=await c.providerRuntime[op](c); return {ok:true,status:200,data:value};
  })
};
module.exports = { adapters, authHeaders };
