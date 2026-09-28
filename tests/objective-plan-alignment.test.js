'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const runnerSrc = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts'),
  'utf8'
);

const match = runnerSrc.match(/function objectivePlanAlignment[\\s\\S]*?\\n\\nasync function executeStep/);
assert.ok(match, 'objectivePlanAlignment function not found');

const jsFunction = match[0]
  .replace(/\\n\\nasync function executeStep[\\s\\S]*$/, '')
  .replace(/:(?:any|string)(?:\\[\\])?/g, '');

const executorType = (step) => String(step?.executor_type || step?.target?.type || '');
const objectivePlanAlignment = new Function('executorType', jsFunction + '\\nreturn objectivePlanAlignment;')(executorType);

const masterObjective = [
  'LIBRO MAESTRO DE LA PWA ARIA — auditoría, corrección y cierre 100% de la PWA real.',
  'Diagnóstico de misiones bloqueadas y recuperación.',
  'PWA LIVE + CI + despliegue.',
  'RWHT físico Windows de las rutas críticas.',
  'Regresión final de todo lo corregido.'
].join('\\n');

assert.equal(
  objectivePlanAlignment(masterObjective, [
    { executor_type: 'agent', operation: 'delegate' }
  ]).ok,
  true,
  'broad master objective must not become a Windows diagnostic or RWHT mission'
);

const explicitDiagnostic = 'Diagnóstico de Windows/Computer Use para encontrar la causa raíz del fallo.';
const diagnosticResult = objectivePlanAlignment(explicitDiagnostic, [
  { executor_type: 'agent', operation: 'delegate' }
]);
assert.equal(diagnosticResult.ok, false);
assert.equal(diagnosticResult.kind, 'diagnostic_surface_mismatch');

const alignedDiagnostic = objectivePlanAlignment(explicitDiagnostic, [
  {
    executor_type: 'device',
    operation: 'computer.use',
    target: { device_id: 'windows-test' },
    risk: 'READ'
  }
]);
assert.equal(alignedDiagnostic.ok, true);

console.log('OBJECTIVE PLAN ALIGNMENT CONTRACT: PASS');
