const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-app-api-v1', 'index.ts'),
  'utf8',
);

if (!source.includes('.schema("aria_internal")')) {
  throw new Error('ARIA APP API must read mission_events from aria_internal schema');
}
if (!source.includes('.from("mission_events")')) {
  throw new Error('mission_events query missing');
}

console.log('aria-app-api-events-schema-regression.test.js: PASS');
