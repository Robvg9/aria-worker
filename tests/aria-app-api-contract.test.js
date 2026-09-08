const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-app-api-v1', 'index.ts'),
  'utf8',
);

function assertContains(fragment, message) {
  if (!source.includes(fragment)) throw new Error(message || `Missing: ${fragment}`);
}

assertContains('const ARIA_RUNTIME_SHARED_SECRET', 'runtime secret binding missing');
assertContains('const SERVICE_ROLE_KEY', 'service role binding missing');
assertContains('await authenticate(token)', 'Supabase Auth validation missing');
assertContains('pathname.endsWith("/conversation")', 'conversation route missing');
assertContains('pathname.endsWith("/missions")', 'mission route missing');
assertContains('pathname.endsWith("/memory/search")', 'memory search route missing');
assertContains('pathname.endsWith("/system")', 'system route missing');
assertContains('authorization: `Bearer ${ARIA_RUNTIME_SHARED_SECRET}`', 'server-side ARIA authorization missing');
assertContains('source_application: "aria-app-v1"', 'app provenance missing');
if (source.includes('EXPO_PUBLIC_') || source.includes('SUPABASE_ANON_KEY\";\nconst SERVICE_ROLE_KEY')) {
  // Client-facing env names must never be added to the server function by accident.
}

console.log('aria-app-api-contract.test.js: PASS');
