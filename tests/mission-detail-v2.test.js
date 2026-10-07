const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/aria-app-api-v3/index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');

assert.match(app, /<div className='panelTitle'>PLAN DE LA MISIÓN<\/div>/);
assert.match(app, /label='Inicio'/);
assert.match(app, /label='Finalización'/);
assert.match(app, /value=\{statusLabel\(status\)\}/);
assert.ok(!app.includes('RECUPERACIÓN / VERIFICACIÓN'));
assert.match(app, /Ya está resuelto · continuar misión/);
assert.match(app, /La misión falló en la comprobación final\./);
assert.match(app, /mutation_verification_evidence_mismatch/);
assert.match(app, /superseded_by_failure/);

assert.match(api, /\/human-gate\/approve/);
assert.match(api, /status: "approved"/);
assert.match(api, /approved_by: user\.id/);

assert.match(runner, /finished_at: new Date\(\)\.toISOString\(\)/);
assert.match(runner, /validateMutationVerificationConsistency/);

console.log('PASS mission-detail-v2');
