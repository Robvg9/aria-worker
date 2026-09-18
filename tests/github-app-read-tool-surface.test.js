'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(
  'supabase/functions/aria-github-app-runtime-v1/index.ts',
  'utf8'
);

assert.match(source, /op==="tree_read"/);
assert.match(source, /git\/trees/);
assert.match(source, /op==="code_search"/);
assert.match(source, /\/search\/code/);
assert.match(source, /repository_not_allowlisted/);

console.log('GITHUB APP READ TOOL SURFACE: PASS');
