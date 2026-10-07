const assert=require('node:assert/strict');
const fs=require('node:fs');
const s=fs.readFileSync('supabase/functions/aria-mission-runner-v22/index.ts','utf8');
const start=s.indexOf('async function createPlan(');
const end=s.indexOf('\\n}\\n',start)+3;
const block=s.slice(start,end);
assert.ok(block.includes('...downstreamHeaders(auth)'));
assert.ok(!block.includes('authorization:\\`Bearer \\${KEY}\\`'));
console.log('MISSION PLANNER AUTH FORWARDING CONTRACT: PASS');