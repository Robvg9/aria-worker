'use strict';
const assert=require('assert');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const root=path.resolve(__dirname,'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aria-eas-patch-'));
const file=path.join(tmp,'index.ts');
const fixture=[
'const AGENT = `${URL}/functions/v1/aria-agent-runtime-v1`;',
'',
'function validateStep(step: any) {',
'  const type = executorType(step);',
'  if (!["connector", "device", "model", "agent"].includes(type)) {',
'    throw new Error(`unknown_executor_type:${type}`);',
'  }',
'  if (type === "agent" && !step.target?.agent_id) throw new Error("agent_target_missing");',
'}',
'',
'async function executeStep(missionId: string, step: any, token: string | null) {',
'  validateStep(step);',
'  const type = executorType(step);',
'  if (type === "agent") return agentExecute(missionId, step, token);',
'  throw new Error(`unknown_executor_type:${type}`);',
'}',
''].join('\n');
fs.writeFileSync(file,fixture);
const r=spawnSync(process.execPath,[path.join(root,'scripts/patch-eas-into-mission-runner-v22.js'),file],{encoding:'utf8'});
assert.strictEqual(r.status,0,r.stderr||r.stdout);
const out=fs.readFileSync(file,'utf8');
assert.match(out,/const EAS_API = 'https:\/\/api\.expo\.dev';/);
assert.match(out,/const EAS_PROJECT_ID/);
assert.match(out,/type === "eas"/);
assert.match(out,/async function easExecute\(step: any\)/);
assert.match(out,/if \(type === "eas"\) return easExecute\(step\);/);
console.log('EAS runner transformer PASS');
