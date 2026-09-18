'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const models = JSON.parse(fs.readFileSync('models/registry.json','utf8'));
const accounts = JSON.parse(fs.readFileSync('accounts/registry.json','utf8'));
const quota = JSON.parse(fs.readFileSync('quota/registry.json','utf8'));

const xaiModel = models.models.find(x => x.model_id === 'xai/grok-4.6');
const xaiAccount = accounts.accounts.find(x => x.account_id === 'acct_xai_primary');
const xaiQuota = quota.entries.find(x => x.account_id === 'acct_xai_primary');

assert.equal(xaiModel?.status, 'unavailable');
assert.equal(xaiAccount?.status, 'inactive');
assert.equal(xaiQuota?.quota?.status, 'unavailable');
assert.equal(xaiQuota?.capacity?.status, 'unavailable');

console.log('XAI REGISTRY CONNECTION STATE: PASS');
