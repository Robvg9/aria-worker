'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('.github/workflows/supabase-canonical-deploy.yml','utf8');
for(const fn of ['aria-planner-v10','aria-autonomy-supervisor-v10','aria-mission-runner-v17','aria-canonical-runtime-v1','aria-direct-v1','aria-memory-v2']) assert.match(source,new RegExp(`functions deploy ${fn}\\b`),`${fn} must be deployed`);
assert.doesNotMatch(source,/functions deploy aria-mission-runner-v14\b/);
console.log('SUPABASE CANONICAL DEPLOY CONTRACT: PASS');
