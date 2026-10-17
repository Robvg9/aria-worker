'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const runner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'index.ts'),
  'utf8',
);
const continuity = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-mission-runner-v22', 'forensic-continuity-fixes.ts'),
  'utf8',
);

assert.match(runner, /function executorType\(step: any\)/);
assert.match(runner, /DEVICE_OPS_ALLOWLIST\.has\(operation\).*return "device"/s);
assert.match(runner, /function normalizeExecutionStep\(step: any, mission: any\)/);
assert.match(runner, /mission\?\.metadata\?\.device_id/);
assert.match(runner, /normalizeExecutionStep\(step, mission\)/);
assert.match(runner, /executor_selected/);
const asyncWaitBranch = runner.match(/if \(waiting\) \{[\s\S]*?await updateMission\(missionId, \{([\s\S]*?)\n\s*\}\);/);
assert.ok(asyncWaitBranch, 'async device wait branch must update the parent mission');
assert.match(asyncWaitBranch[1], /status:\s*"waiting"/, 'parent mission must stay executable while its physical job is pending');
assert.doesNotMatch(asyncWaitBranch[1], /status:\s*"paused"/, 'paused is a fail-closed authorization stop, not an async executor wait state');
assert.match(continuity, /"computer\.use"/);
assert.match(continuity, /"computer\.use\.autonomous"/);
assert.match(continuity, /"computer\.use\.android"/);
assert.match(continuity, /input\.operation === undefined/);
assert.match(continuity, /input\.action === "observe"/);
assert.match(continuity, /input\.operation = "observe"/);


const deployGuard = runner.match(/function isCuevacoinAuthorizedDeployMission\(goal: unknown\): boolean \{[\s\S]*?\n\}/);
const readGuard = runner.match(/function isCuevacoinAuthorizedReadMission\(goal: unknown\): boolean \{[\s\S]*?\n\}/);
assert.ok(deployGuard, 'CuevaCoin deploy authorization predicate must exist');
assert.ok(readGuard, 'CuevaCoin read authorization predicate must be defined before its call sites');
assert.ok(
  runner.indexOf('function isCuevacoinAuthorizedReadMission')
    < runner.indexOf('async function cuevacoinAuthorizedReadOnlyExecute'),
  'CuevaCoin read authorization predicate must precede the guarded executor',
);
const executablePredicates = [deployGuard[0], readGuard[0]]
  .map((source) => source.replace('(goal: unknown): boolean {', '(goal) {'))
  .join('\n');
const predicates = {};
vm.runInNewContext(
  executablePredicates
    + '\nthis.isCuevacoinAuthorizedDeployMission = isCuevacoinAuthorizedDeployMission;'
    + '\nthis.isCuevacoinAuthorizedReadMission = isCuevacoinAuthorizedReadMission;',
  predicates,
);
const deployGoal = '/ARIA-CuevaCoin cerrar el paso 8 con cuevacoin_project_control desde .github/workflows/cuevacoin-deploy.yml en Robvg9/CuevaCoin proyecto zqgmjwfvluboiporytcq confirm_project_ref, sin cambios SQL ni operaciones financieras, main, despliegue controlado autorizado';
const readOnlyGoal = 'Verificar el control autorizado de CuevaCoin desde ARIA; ejecuta cuevacoin_connection_status y cuevacoin_project_control con scope OAuth aria.project.cuevacoin.control; no despliegues, no escribas en el repositorio, no ejecutes migraciones y no realices operaciones financieras.';
const unboundedReadGoal = 'Verifica CuevaCoin ejecutando cuevacoin_connection_status y cuevacoin_project_control con scope OAuth aria.project.cuevacoin.control, sin restricciones adicionales.';
assert.equal(predicates.isCuevacoinAuthorizedDeployMission(deployGoal), true);
assert.equal(predicates.isCuevacoinAuthorizedReadMission(deployGoal), false);
assert.equal(predicates.isCuevacoinAuthorizedReadMission(readOnlyGoal), true);
assert.equal(predicates.isCuevacoinAuthorizedReadMission(unboundedReadGoal), false);

console.log('MISSION RUNNER V22 EXECUTOR INFERENCE CONTRACT: PASS');
