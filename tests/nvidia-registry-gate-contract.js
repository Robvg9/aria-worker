'use strict';

const assert = require('node:assert/strict');
const registry = require('../models/registry.json');
const { select } = require('../router/intelligent-v2');

const nvidia = registry.models.filter(m => m.provider_id === 'nvidia');
assert.equal(nvidia.length, 4);
for (const model of nvidia) {
  assert.equal(model.status, 'unavailable');
  assert.equal(model.availability, 'restricted');
  assert.equal(model.metadata.nvidia_free_endpoint, true);
  assert.equal(model.metadata.integration_status, 'not_connected');
  assert.equal(model.metadata.live_verified, false);
  assert.equal(model.metadata.access_path, 'nvidia_nim_api_catalog');
}

const candidates = nvidia.map(model => ({
  model,
  capability_verified: false,
  live_verified: false,
  account: { account_id: 'pending', status: 'unknown', enabled: true },
  quota: { status: 'unknown' },
  agents: []
}));

const route = select(candidates, { task: 'code and debug this change' });
assert.equal(route.status, 'no_route');
assert.equal(route.reason, 'no_eligible_candidate');

console.log('nvidia registry gate tests: PASS');
