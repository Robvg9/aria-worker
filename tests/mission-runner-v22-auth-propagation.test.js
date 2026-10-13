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


const agentStart = source.indexOf('async function agentExecute');
const agentEnd = source.indexOf('async function easGraphQL', agentStart);
assert.ok(agentStart >= 0 && agentEnd > agentStart, 'agentExecute block must be addressable');
const agentBlock = source.slice(agentStart, agentEnd);
assert.match(source, /function agentRuntimeHeaders\(\)/, 'agent runtime requires internal service headers');
assert.match(source, /headers\["x-aria-internal-service-key"\]\s*=\s*KEY/, 'internal executor key must be forwarded explicitly');
assert.match(agentBlock, /headers:\s*agentRuntimeHeaders\(\)/, 'agentExecute must use internal service headers');
assert.doesNotMatch(agentBlock, /headers:\s*downstreamHeaders\(auth\)/, 'agentExecute must not forward an arbitrary caller token');
