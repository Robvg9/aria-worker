'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('supabase/functions/aria-planner-v11/index.ts','utf8');
for (const marker of [
  'modelRoutes',
  'selfAuditPlan',
  'const changeStep=',
  'const repairStep=',
  'planner-v11-forensic-multi-route-v1',
  'planner-v11-governed-change-v2',
  'planner-v11-model-aware'
]) assert.ok(source.includes(marker), `planner LIVE-sync marker missing: ${marker}`);

const mutation=source.match(/const mutationIntent=.*?\.test\(g\);/);
assert.ok(mutation,'mutation intent contract missing');
for (const term of ['corregir','crear','implementar','modificar','actualizar','añadir','anadir','eliminar','desarrollar','refactorizar','escribir','migrar','promover']) {
  assert.ok(mutation[0].includes(term), `Spanish mutation term missing: ${term}`);
}
console.log('PLANNER V11 LIVE SYNC + SPANISH INTENT CONTRACT: PASS');
