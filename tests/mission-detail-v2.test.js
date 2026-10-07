const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const app = fs.readFileSync(path.join(root, 'pwa/src/App.tsx'), 'utf8');
const api = fs.readFileSync(path.join(root, 'supabase/functions/aria-app-api-v3/index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');

assert.match(app, /<div className='panelTitle'>PLAN DE LA MISIÓN<\/div>/);
assert.match(app, /label='Inicio'/);
assert.match(app, /label: 'Objetivo comprobado'/);
assert.match(app, /ARIA verificó el objetivo con la evidencia registrada y cerró la misión correctamente/);
assert.match(app, /status === 'succeeded' && structurallyVerified/);
assert.match(app, /label='Finalización'/);
assert.match(app, /status === 'failed' \? 'FALLIDA' : statusLabel\(status\)/);
assert.ok(!app.includes('RECUPERACIÓN / VERIFICACIÓN'));
assert.match(app, /Ya está resuelto · continuar misión/);
assert.match(app, /La misión falló en la comprobación final\./);
assert.match(app, /mutation_verification_evidence_mismatch/);
assert.match(app, /superseded_by_failure/);
assert.match(app, /const selectedLive = selected/);
assert.match(app, /const visibleItems = historyExpanded/);

assert.match(api, /\/human-gate\/approve/);
assert.match(api, /\/verify-retry/);
assert.match(api, /human_requested_verification_retry/);
assert.match(api, /preserved_completed_steps/);
assert.match(api, /status: "completed"/);
assert.match(api, /approved_by: user\.id/);
assert.match(api, /verified: true/);

assert.match(runner, /finished_at: new Date\(\)\.toISOString\(\)/);
assert.match(runner, /validateMutationVerificationConsistency/);

console.log('PASS mission-detail-v2');
