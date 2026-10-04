'use strict';
const assert=require('node:assert/strict');
const {VERSION,ACTION_MODE,auditProactiveConsistency}=require('../consistency-auditor-v1');
assert.equal(VERSION,'aria-proactive-consistency-auditor-v1.0.0');
assert.equal(ACTION_MODE,'recommendation_only');
console.log('PROACTIVE CONSISTENCY AUDITOR V1: PASS');
