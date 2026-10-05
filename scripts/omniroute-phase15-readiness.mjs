#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const p=path.join(__dirname,'..','absorb','omniroute','PHASE_15_REGISTRATION_PROPOSAL.json');
const m=JSON.parse(fs.readFileSync(p,'utf8'));
const required=['capability_id','source','version','permissions','dependency','health','evidence','rollback','evolution'];
const missing=required.filter(k=>!(k in m));
const liveReady=m.health.live_gateway==='PASS'&&m.health.local_ollama!=='NO_RESPONSE'&&m.evidence.canonical_e2e==='PASS_LIVE';
const safe=m.active===false&&m.enablement==='DISABLED';
const result={capability_id:m.capability_id,manifest_complete:missing.length===0,safe_default_disabled:safe,live_ready:liveReady,promotion:liveReady&&safe?'READY_FOR_REVIEW':'BLOCKED_PENDING_LIVE_E2E',missing};
console.log(JSON.stringify(result,null,2));
process.exit(result.manifest_complete&&safe?0:1);