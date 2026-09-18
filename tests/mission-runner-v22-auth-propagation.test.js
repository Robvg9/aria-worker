'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(
  'supabase/functions/aria-mission-runner-v22/index.ts',
  'utf8'
);

assert.match(source, /type AuthContext/);
assert.match(source, /kind:\s*"authorization"/);
assert.match(source, /kind:\s*"autonomy-token"/);
assert.match(source, /headers\.authorization\s*=\s*`Bearer \$\{auth\.token\}`/);
assert.match(source, /headers\["x-aria-autonomy-token"\]\s*=\s*auth\.token/);
assert.match(source, /downstreamHeaders\(auth\)/);
assert.doesNotMatch(source, /downstreamHeaders\(token\)/);

console.log('MISSION RUNNER V22 AUTH SCHEME PROPAGATION: PASS');
