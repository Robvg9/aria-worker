'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execFileAsync = promisify(execFile);
const { createSelfImprovementCoordinatorV1 } = require('../autonomy/self-improvement-coordinator-v1');

const WORKSPACE_ROOT = path.resolve(__dirname, '..', 'self-improvement-workspace');
const EVIDENCE_PATH = path.resolve(__dirname, '..', '..', 'Data', 'self-improvement-last.json');
const SAFE_RISKS = new Set(['LOW']);
const SAFE_CATEGORIES = new Set(['reliability', 'performance', 'documentation', 'observability', 'capability_gap', 'regression']);

function parseSelfImprovementPayload(job, deviceId) {
  if (!job || job.device_id !== deviceId || job.operation !== 'self.improve') throw new Error('unsupported_self_improvement_job');
  if (typeof job.command !== 'string' || !job.command.trim()) throw new Error('self_improvement_payload_required');
  let payload;
  try { payload = JSON.parse(job.command); } catch { throw new Error('self_improvement_payload_invalid_json'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('self_improvement_payload_invalid');
  const allowed = ['goal', 'category', 'risk', 'scope', 'proposed_changes', 'mission_id', 'step_id', 'device_id'];
  if (Object.keys(payload).some((key) => !allowed.includes(key))) throw new Error('self_improvement_payload_field_rejected');
  if (payload.device_id !== undefined && String(payload.device_id) !== String(deviceId)) throw new Error('self_improvement_payload_device_mismatch');
  if (typeof payload.goal !== 'string' || !payload.goal.trim()) throw new Error('self_improvement_goal_required');
  if (!SAFE_CATEGORIES.has(String(payload.category || 'capability_gap'))) throw new Error('self_improvement_category_rejected');
  if (!SAFE_RISKS.has(String(payload.risk || 'LOW').toUpperCase())) throw new Error('self_improvement_risk_rejected');
  if (!Array.isArray(payload.scope)) throw new Error('self_improvement_scope_required');
  if (!Array.isArray(payload.proposed_changes)) throw new Error('self_improvement_proposed_changes_required');
  const proposedChanges = payload.proposed_changes.slice(0, 50).map((change) => {
    if (!change || typeof change !== 'object') throw new Error('self_improvement_change_invalid');
    if (String(change.risk_level || 'LOW').toUpperCase() !== 'LOW') throw new Error('self_improvement_change_risk_rejected');
    return { ...change, risk_level: 'low' };
  });
  return { goal: payload.goal.trim().slice(0,1000), category: String(payload.category || 'capability_gap'), risk: String(payload.risk || 'LOW').toUpperCase(), scope: payload.scope.slice(0,20).map(String), proposed_changes: proposedChanges, mission_id: payload.mission_id || null, step_id: payload.step_id || null };
}
function safeWorkspacePath(relativePath) { if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('workspace_path_required'); const normalized = relativePath.replace(/\\/g,'/').replace(/^\/+/, ''); if (normalized.includes('..') || path.isAbsolute(normalized)) throw new Error('workspace_path_unsafe'); const absolute = path.resolve(WORKSPACE_ROOT, normalized); if (!(absolute === WORKSPACE_ROOT || absolute.startsWith(WORKSPACE_ROOT + path.sep))) throw new Error('workspace_path_escape'); return { normalized, absolute }; }
async function createWorkspace() {
  await fs.mkdir(WORKSPACE_ROOT,{recursive:true});
  const read = async (relativePath) => { const target = safeWorkspacePath(relativePath); try { return await fs.readFile(target.absolute,'utf8'); } catch(error) { if(error?.code==='ENOENT') return ''; throw error; } };
  const apply = async (change) => { if(!change || String(change.risk_level || 'LOW').toUpperCase()!=='LOW') return {status:'blocked',reason:'risk_not_allowed'}; const target=safeWorkspacePath(change.path); await fs.mkdir(path.dirname(target.absolute),{recursive:true}); await fs.writeFile(target.absolute,String(change.content || ''),'utf8'); return {status:'succeeded',path:target.normalized,sandbox:true}; };
  const restore = async () => ({status:'blocked',reason:'restore_not_enabled_in_runtime_sandbox'});
  return {read,apply,restore};
}
async function testWorkspace({scope=[]}={}) {
  const results=[];
  for(const relativePath of scope){const target=safeWorkspacePath(relativePath);try{await fs.access(target.absolute);if(/\.(?:js|cjs|mjs)$/i.test(target.normalized)) await execFileAsync(process.execPath,['--check',target.absolute],{windowsHide:true,timeout:30000,maxBuffer:64*1024});results.push({path:target.normalized,status:'passed'});}catch(error){results.push({path:target.normalized,status:'failed',error:String(error?.message||error)});}}
  return {status:results.every(item=>item.status==='passed')?'passed':'failed',results,scope:results.map(item=>item.path)};
}
function buildSnapshot(){return async(include=[])=>({identity:'ARIA',version:'windows-local-agent-v2',capabilities:['self_improvement_sandbox','filesystem_stage','node_syntax_test'],tools:['node','self-improvement-coordinator-v1'],connectors:['aria-device-gateway'],providers:[],health:{status:'ready'},tests:{status:'available',runner:'node --check'},git:{branch:'self-improvement-sandbox',isolated:true},inspected:Array.isArray(include)?include:[]});}
async function writeEvidence(evidence){await fs.mkdir(path.dirname(EVIDENCE_PATH),{recursive:true});await fs.writeFile(EVIDENCE_PATH,JSON.stringify(evidence,null,2),'utf8');return{status:'succeeded',path:EVIDENCE_PATH};}
async function executeSelfImprovementJob(job,deviceId){const signal=parseSelfImprovementPayload(job,deviceId);const workspace=await createWorkspace();const coordinator=createSelfImprovementCoordinatorV1({snapshot:buildSnapshot(),workspace,testRunner:testWorkspace,writer:async(payload)=>writeEvidence({recorded_at:new Date().toISOString(),mission_id:signal.mission_id,step_id:signal.step_id,coordinator:'self-improvement-coordinator-v1',objective:signal.goal,payload}),policy:{max_risk:'low',protected_paths:['main','master']},selfModel:{identity:'ARIA',canonicalEntrypoint:'aria-canonical-runtime-v1',softwareVersion:'windows-local-agent-v2',capabilities:['self_improvement_sandbox']}});const result=await coordinator.engine.run(signal);return{status:result.status==='completed'&&result.stop_reason==='verified'?'succeeded':result.status==='blocked'?'blocked':'failed',exit_code:result.status==='completed'?0:1,stdout:'',stderr:result.status==='completed'?'':String(result.stop_reason||'self_improvement_failed'),coordinator_status:result.status,stop_reason:result.stop_reason||null,version:result.version||null,evidence_hash:result.evidence_hash||null,stages:result.stages||[],cycles:result.cycles||[],metadata:{agent_version:'aria-windows-agent-v2',operation:'self.improve',coordinator:'self-improvement-coordinator-v1',sandbox:true,promotion:'human_gate',deployment:'human_gate'}};}
module.exports=Object.freeze({WORKSPACE_ROOT,parseSelfImprovementPayload,executeSelfImprovementJob});