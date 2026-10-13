'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const planner = fs.readFileSync(path.join(root, 'supabase/functions/aria-planner-v11/index.ts'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'supabase/functions/aria-mission-runner-v22/index.ts'), 'utf8');

const reviewStart = planner.indexOf('async function projectReviewPlan');
const reviewEnd = planner.indexOf('async function allForOnePlan', reviewStart);
assert.ok(reviewStart >= 0 && reviewEnd > reviewStart, 'project review planner function must exist');
const projectReview = planner.slice(reviewStart, reviewEnd);
assert.ok(projectReview.includes('const routes=await modelRoutes()'), 'project review must use currently registered model routes');
assert.ok(projectReview.includes('const safeRoutes=routes.filter'), 'project review must restrict fallback to approved direct routes');
assert.ok(projectReview.includes('String(route.provider_id||"").toLowerCase()==="google"'), 'project review must not reopen blocked external providers');
assert.ok(projectReview.includes('modelStep("facts_1"'), 'facts phase must execute through a model route');
assert.ok(projectReview.includes('modelStep("crosscheck_1"'), 'cross-check phase must execute through a model route');
assert.ok(projectReview.includes('modelStep("summary_1"'), 'summary phase must execute through a model route');
assert.ok(!projectReview.includes('agentStep("facts_1"'), 'facts must not depend on the same generic reviewer agent');
assert.ok(projectReview.includes('aria-planner-v11-live-project-review-v3-multi-model'), 'new multi-model planner version must be traceable');

const routingStart = planner.indexOf('const operationAudit=await operationAuditPlan(goal,context)');
const routingEnd = planner.indexOf('if(/self[- ]audit', routingStart);
assert.ok(routingStart >= 0 && routingEnd > routingStart, 'planner dispatch section must be readable');
const routing = planner.slice(routingStart, routingEnd);
assert.ok(routing.includes('const projectWriteIntent='), 'project review dispatch must detect write/deployment intent');
assert.ok(routing.includes('&& !projectWriteIntent'), 'write/deployment intent must bypass the read-only project-review shortcut');

const cuevaStep8Goal = 'Continúa exclusivamente el paso 8 de /ARIA-CuevaCoin. Ejecuta cuevacoin_connection_status y verifica el acceso real. Identifica permisos para publicar. Implementa y revisa .github/workflows/cuevacoin-deploy.yml en una rama. Despliega mediante workflow_dispatch desde main.';
const reviewPattern = /revisa|revisar|review|audita|auditar|estado.*(aria|proyecto)|project.*status|what.*wrong|review.*aria|audit.*aria/i;
const writePattern = /\b(create|creates|build|implement\w*|repair|fix|modify|update|add|remove|write|migrate\w*|promote|deploy\w*|publish\w*|release\w*|merge\w*|dispatch\w*|workflow_dispatch|crear|crea|construir|implemen\w*|reparar|arreglar|modificar|actualizar|añadir|anadir|eliminar|escribir|migrar|migraci[oó]n|publicar|publicaci[oó]n|despleg\w*|fusionar|despachar)\b/i;
assert.match(cuevaStep8Goal, reviewPattern, 'regression fixture must reproduce the broad review match');
assert.match(cuevaStep8Goal, writePattern, 'regression fixture must reproduce explicit deployment/mutation intent');
assert.ok(reviewPattern.test(cuevaStep8Goal) && writePattern.test(cuevaStep8Goal), 'mixed CuevaCoin mission must be classified as mutating before read-only review routing');

assert.ok(runner.includes('function isReadOnlyPlanRecoveryAllowed(goal: string)'), 'empty-plan fallback must enforce read-only eligibility');
assert.ok(runner.includes('async function buildReadOnlyPlanFallback'), 'deterministic read-only fallback must exist');
assert.ok(runner.includes('planner_empty_steps_detected'), 'empty plans must leave persisted diagnostics');
assert.ok(runner.includes('planner_empty_readonly_fallback_selected'), 'selected fallback strategy must be recorded');
assert.ok(runner.includes('write_tasks_never_model_only: true'), 'write/deploy goals must never fall back to model-only success');
assert.ok(runner.includes('planner_empty_steps'), 'non-recoverable empty plans must remain truthfully blocked');
const mutationIntentLine = runner.split(String.fromCharCode(10)).find(line => line.includes('const mutationIntent =')) || '';
assert.ok(mutationIntentLine.includes('publish') && mutationIntentLine.includes('deploy'), 'publishing/deployment intent must fail closed');
const fallbackStart = runner.indexOf('async function buildReadOnlyPlanFallback');
const fallbackEnd = runner.indexOf('function executorType(step: any)', fallbackStart);
const fallback = runner.slice(fallbackStart, fallbackEnd);
assert.ok(fallback.includes('provider === "google" && modelId.endsWith("-direct")'), 'empty-plan fallback must use direct Google routes only');
assert.ok(!fallback.includes('provider === "openrouter"'), 'empty-plan fallback must not reopen OpenRouter');
console.log('Meditation IA planner and empty-plan recovery contract: PASS');
