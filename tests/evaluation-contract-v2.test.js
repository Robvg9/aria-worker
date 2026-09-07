'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const text=fs.readFileSync(require.resolve('../evaluation/contract-v2.md'),'utf8');
for(const term of ['unit','integration','security','behavior','regression','live','100 missions','success rate','verification rate','recovery rate','regression rate','average attempts','failure modes','reliability score','fail-closed','Unknown data remains unknown']) assert.ok(text.toLowerCase().includes(term.toLowerCase()),`missing contract term: ${term}`);
assert.equal(/store credentials or secrets/i.test(text),true);
assert.equal(/must not be described as evidence from 100 real production missions/i.test(text),true);
console.log('EVALUATION ENGINE 2.0 CONTRACT: PASS');
