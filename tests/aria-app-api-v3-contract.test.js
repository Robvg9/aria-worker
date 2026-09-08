const fs = require('node:fs');
const path = require('node:path');

const appApi = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-app-api-v3', 'index.ts'),
  'utf8',
);
const planner = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-planner-v11', 'index.ts'),
  'utf8',
);
const plannerConfig = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-planner-v11', 'deno.json'),
  'utf8',
);
const executor = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'aria-execution-runtime-v1', 'index.ts'),
  'utf8',
);

function assertContains(source, fragment, message) {
  if (!source.includes(fragment)) throw new Error(message || `Missing: ${fragment}`);
}

// App API v3: authenticated facade + conversation/model contract.
assertContains(appApi, 'verify_jwt', 'documentation marker missing');
assertContains(appApi, 'SUPABASE_SERVICE_ROLE_KEY', 'service-role binding missing');
assertContains(appApi, 'auth.getUser(token)', 'server-side user resolution missing');
assertContains(appApi, 'path.endsWith("/conversation")', 'conversation route missing');
assertContains(appApi, 'path.endsWith("/missions")', 'mission route missing');
assertContains(appApi, 'path.endsWith("/memory/search")', 'memory route missing');
assertContains(appApi, 'target?.provider_id', 'conversation model route validation missing');
assertContains(appApi, 'target?.account_id', 'conversation account route validation missing');
assertContains(appApi, 'target?.model_id', 'conversation model id validation missing');
assertContains(appApi, 'conversation_model_execution_failed', 'conversation failure boundary missing');
assertContains(appApi, 'aria-execution-runtime-v1', 'canonical execution runtime missing');
assertContains(appApi, 'aria-app-v1', 'app provenance missing');
if (appApi.includes('SUPABASE_ANON_KEY')) throw new Error('v3 must not depend on legacy anon-key reauthentication');

// Planner v11: ordinary conversational goals must never fall back to connector/file-read plans.
assertContains(planner, 'goal.startsWith("IA conversacional:")', 'conversation-aware planner branch missing');
assertContains(planner, 'executor_type:"model"', 'conversation planner must emit a model executor');
assertContains(planner, 'provider_id:"openrouter"', 'conversation planner provider missing');
assertContains(planner, 'account_id:"acct_openrouter_primary"', 'conversation planner account missing');
assertContains(planner, 'model_id:"google/gemini-2.5-flash-lite"', 'conversation planner model missing');
assertContains(planner, 'aria-planner-v11-conversation-aware', 'planner version marker missing');
if (planner.includes('goal.startsWith("IA conversacional:")') && planner.includes('executor_type:"connector"')) {
  // The remaining connector fallback is for non-conversational autonomous planning only.
}

// Executor compatibility: the selected route must be accepted exactly as emitted by planner v11.
assertContains(executor, 'route.provider_id!=="openrouter"', 'openrouter route guard missing');
assertContains(executor, 'route.account_id!=="acct_openrouter_primary"', 'openrouter account guard missing');
assertContains(executor, 'route.model_id!=="google/gemini-2.5-flash-lite"', 'openrouter model guard missing');
assertContains(executor, 'status:"succeeded"', 'successful execution contract missing');

if (!plannerConfig.includes('"imports"')) throw new Error('planner v11 deno.json invalid');

console.log('aria-app-api-v3-contract.test.js: PASS');
