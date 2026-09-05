const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fn = fs.readFileSync(path.join(root, 'supabase/functions/aria-memory-v2/index.ts'), 'utf8');
const migrationFiles = fs.readdirSync(path.join(root, 'supabase/migrations'));

assert.ok(fn.includes('aria-cognitive-memory'), 'memory gateway service missing');
assert.ok(fn.includes('aria-memory-v2'), 'memory gateway version missing');
assert.ok(fn.includes('gte-small'), 'canonical embedding model missing');
assert.ok(fn.includes('remember_with_embedding'), 'embedding write RPC missing');
assert.ok(fn.includes('search_hybrid_text'), 'hybrid search RPC missing');
assert.ok(fn.includes('aria_autonomy_cron_authorize'), 'cron authorization boundary missing');
assert.ok(fn.includes('semantic_backfill'), 'semantic backfill capability missing');
assert.ok(migrationFiles.some(name => name.includes('memory_2_0_recall_maintenance')), 'memory recall migration not versioned');
assert.ok(migrationFiles.some(name => name.includes('memory_2_0_semantic_scheduler')), 'memory scheduler migration not versioned');

console.log('memory-v2-contract: PASS');
