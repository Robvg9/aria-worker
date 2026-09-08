const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const appApi = read('supabase', 'functions', 'aria-app-api-v3', 'index.ts');
const planner = read('supabase', 'functions', 'aria-planner-v11', 'index.ts');
const plannerConfig = read('supabase', 'functions', 'aria-planner-v11', 'deno.json');
const memory = read('supabase', 'functions', 'aria-memory-v2', 'index.ts');
const executor = read('supabase', 'functions', 'aria-execution-runtime-v1', 'index.ts');
const appWorkflow = read('.github', 'workflows', 'aria-app-api-v3-deploy.yml');
const plannerWorkflow = read('.github', 'workflows', 'aria-planner-v11-deploy.yml');

function assertContains(source, fragment, message) {
  if (!source.includes(fragment)) throw new Error(message || `Missing: ${fragment}`);
}

// App API v3: authenticated facade + conversation/model contract.
assertContains(appApi, 'SUPABASE_SERVICE_ROLE_KEY', 'service-role binding missing');
assertContains(appApi, 'auth.getUser(token)', 'server-side user resolution missing');
assertContains(appApi, 'path.endsWith("/conversation")', 'conversation route missing');
assertContains(appApi, 'path.endsWith("/missions")', 'mission route missing');
assertContains(appApi, 'path.endsWith("/memory/search")', 'memory search route missing');
assertContains(appApi, 'path.endsWith("/media/upload-url")', 'media upload preparation route missing');
assertContains(appApi, 'aria-app-media', 'private media bucket missing');
assertContains(appApi, 'const objectPath = `${user.id}/${mediaId}/${fileName}`', 'media object path is not user-scoped');
assertContains(appApi, 'createSignedUploadUrl(objectPath)', 'signed media upload missing');
assertContains(appApi, '"x-aria-user-id": userId', 'authenticated user scope not propagated to internal memory/mission boundary');
assertContains(appApi, 'recall(goal, user.id)', 'conversation recall is not user-scoped');
assertContains(appApi, 'target?.provider_id', 'conversation model route validation missing');
assertContains(appApi, 'target?.account_id', 'conversation account route validation missing');
assertContains(appApi, 'target?.model_id', 'conversation model id validation missing');
assertContains(appApi, 'conversation_model_execution_failed', 'conversation failure boundary missing');
assertContains(appApi, 'aria-execution-runtime-v1', 'canonical execution runtime missing');
assertContains(appApi, 'aria-app-v1', 'app provenance missing');
if (appApi.includes('SUPABASE_ANON_KEY')) throw new Error('v3 must not depend on legacy anon-key reauthentication');
assertContains(appWorkflow, 'supabase functions deploy aria-app-api-v3 --project-ref', 'app v3 deployment command missing');
if (appWorkflow.includes('--verify-jwt')) throw new Error('app v3 workflow uses removed Supabase CLI verify-jwt flag');

// Memory v2: app-scoped operations must carry a user id and use scoped RPCs.
assertContains(memory, 'x-aria-user-id', 'memory user-scope header missing');
assertContains(memory, 'aria_memory_search_hybrid_user_scoped', 'scoped memory search RPC missing');
assertContains(memory, 'aria_memory_remember_user_scoped', 'scoped memory remember RPC missing');
assertContains(memory, 'scope:\'user\'', 'memory user-scope result marker missing');

// Planner v11: ordinary conversational goals must never fall back to connector/file-read plans.
assertContains(planner, 'goal.startsWith("IA conversacional:")', 'conversation-aware planner branch missing');
assertContains(planner, 'executor_type:"model"', 'conversation planner must emit a model executor');
assertContains(planner, 'provider_id:"openrouter"', 'conversation planner provider missing');
assertContains(planner, 'account_id:"acct_openrouter_primary"', 'conversation planner account missing');
assertContains(planner, 'model_id:"google/gemini-2.5-flash-lite"', 'conversation planner model missing');
assertContains(planner, 'aria-planner-v11-conversation-aware', 'planner version marker missing');
assertContains(plannerWorkflow, 'node tests/aria-app-api-v3-contract.test.js', 'planner contract gate missing');
assertContains(plannerWorkflow, 'supabase functions deploy aria-planner-v11 --project-ref', 'planner deployment command missing');
if (plannerWorkflow.includes('--verify-jwt')) throw new Error('planner workflow uses removed Supabase CLI verify-jwt flag');

// Executor compatibility: route emitted by planner v11 is accepted by the canonical executor.
assertContains(executor, 'route.provider_id!=="openrouter"', 'openrouter route guard missing');
assertContains(executor, 'route.account_id!=="acct_openrouter_primary"', 'openrouter account guard missing');
assertContains(executor, 'route.model_id!=="google/gemini-2.5-flash-lite"', 'openrouter model guard missing');
assertContains(executor, 'status:"succeeded"', 'successful execution contract missing');

if (!plannerConfig.includes('"imports"')) throw new Error('planner v11 deno.json invalid');

console.log('aria-app-api-v3-contract.test.js: PASS');
