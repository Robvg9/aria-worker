'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(
  'supabase/functions/aria-github-app-runtime-v1/index.ts',
  'utf8'
);

assert.match(source, /async function installationToken\(repository:string\)/);
assert.match(source, /repositories:\[repository\]/);
assert.match(source, /installationToken\(rp\)/);
assert.doesNotMatch(source, /repositories:\[DEFAULT_REPO\]/);

console.log('GITHUB APP INSTALLATION REPO SCOPE: PASS');
