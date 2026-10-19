'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const contractPath = path.join(__dirname, '..', 'supabase', 'functions', 'aria-runtime-gateway-v1', 'index.ts');
const contract = fs.readFileSync(contractPath, 'utf8');

assert.match(contract, /action===\"self_improve\"/);
assert.match(contract, /version:\"self-improvement-runtime-v1\"/);
assert.match(contract, /promote:false/);
assert.match(contract, /deploy:false/);
assert.match(contract, /human_gate_required/);
assert.match(contract, /autonomy_frontier/);
assert.match(contract, /category_not_autonomous/);

console.log('SELF_IMPROVEMENT_RUNTIME_GATEWAY_V1_OK');
