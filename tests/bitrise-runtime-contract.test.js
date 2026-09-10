'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'bitrise.ts'),
  'utf8',
);

assert.match(source, /aria_bitrise_credential_read_secret/);
assert.doesNotMatch(source, /rpc\("aria_internal\.credential_read_secret"/);
assert.match(source, /https:\/\/api\.bitrise\.io\/v0\.1/);
assert.match(source, /bitrise_trigger_build/);
assert.match(source, /bitrise_list_artifacts/);
assert.match(source, /Authorization: token/);
assert.doesNotMatch(source, /console\.(log|error).*token/);

console.log('BITRISE RUNTIME CONTRACT: PASS — canonical Credential Manager wrapper, provider API, operations, and secret-boundary checks');
