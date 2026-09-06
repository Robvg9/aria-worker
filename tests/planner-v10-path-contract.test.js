'use strict';
const assert=require('node:assert/strict');
const source=require('fs').readFileSync('supabase/functions/aria-planner-v10/index.ts','utf8');
assert.match(source,/autonomy\/orchestrator\.js/);
assert.doesNotMatch(source,/execution\/orchestrator\.js/);
assert.match(source,/autonomy\/coordinator\.js/);
console.log('PLANNER V10 CANONICAL PATH CONTRACT: PASS');
