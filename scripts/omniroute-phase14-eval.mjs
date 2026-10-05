#!/usr/bin/env node
'use strict';

const matrix=[
 {path:'aria_default_router',authority:'ARIA',evidence:'canonical',fallback:'canonical',security:'ARIA',local_qwen:'no',live_quality:'PENDING'},
 {path:'omniroute_governed',authority:'ARIA',evidence:'canonical+gateway',fallback:'Phase9',security:'Phase11',local_qwen:'yes-via-loopback',live_quality:'PENDING'},
 {path:'omniroute_local_qwen',authority:'ARIA',evidence:'canonical+gateway+model',fallback:'Phase9',security:'Phase11',local_qwen:'yes',live_quality:'PENDING'}
];

function score(row){
 const checks={authority:row.authority==='ARIA',evidence:row.evidence!=='',fallback:row.fallback!=='',security:row.security!=='',local_qwen:row.local_qwen!=='no'};
 return {path:row.path,checks,static_gate:Object.values(checks).every(Boolean)?'PASS':'PARTIAL',live_quality:row.live_quality};
}
const result={
version:'aria-omniroute-comparative-eval-v1.0.0',
scope:'architecture_and_governance_only',
warning:'No latency, quality, cost or provider-success claims are made because the local OmniRoute gateway was not LIVE during certification.',
results:matrix.map(score),
winner_for_current_free_local_goal:'omniroute_local_qwen',
reason:'It preserves ARIA authority while allowing a loopback OmniRoute gateway to target a local Qwen runtime; LIVE quality remains unverified.',
promotion:'BLOCKED_PENDING_LIVE_E2E'
};
console.log(JSON.stringify(result,null,2));
if(result.results.some(x=>x.static_gate!=='PASS'))process.exit(1);