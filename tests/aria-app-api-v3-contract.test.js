const assert = require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(...parts)=>fs.readFileSync(path.join(__dirname,'..',...parts),'utf8');
const appApi=read('supabase','functions','aria-app-api-v3','index.ts');
const pwa=read('pwa','src','App.tsx');
const planner=read('supabase','functions','aria-planner-v11','index.ts');
const plannerConfig=read('supabase','functions','aria-planner-v11','deno.json');
const memory=read('supabase','functions','aria-memory-v2','index.ts');
const executor=read('supabase','functions','aria-execution-runtime-v1','index.ts');
const appWorkflow=read('.github','workflows','aria-app-api-v3-deploy.yml');
const plannerWorkflow=read('.github','workflows','aria-planner-v11-deploy.yml');
function assertContains(source,fragment,message){if(!source.includes(fragment))throw new Error(message||`Missing: ${fragment}`);}
function assertAny(source,fragments,message){if(!fragments.some(f=>source.includes(f)))throw new Error(message||`Missing one of: ${fragments.join(' | ')}`);}
assertContains(appApi,'SUPABASE_SERVICE_ROLE_KEY','service-role binding missing');
assertContains(appApi,'auth.getClaims(token)','server-side JWT claims verification missing');
if(appApi.includes('auth.getUser(token)'))throw new Error('app v3 auth path must not perform network user lookup per request');
assertContains(appApi,'path.endsWith("/conversation")','conversation route missing');
assertContains(appApi,'path.endsWith("/conversation") && !path.includes("/projects/")','generic conversation route must not catch project conversation requests');
assertContains(appApi,'function looksLikeMissionRequest(input: string)','chat mission intent classifier missing');
assertContains(appApi,'(?:haz|has)\\s+que\\b/i.test(value)','chat must classify direct "haz que..." and common "has que..." commands as missions');
assertContains(appApi,'if (explicitTask) return true;','explicit "quiero que..." / "necesito que..." phrasing must bypass finite-verb matching');
assertContains(appApi,'mueve|mover|pon|poner|organiza|organizar','chat mission classifier must recognize common UI/action commands');
assertContains(appApi,'internal(DIRECT, {','chat mission handoff must reuse canonical DIRECT mission intake');
assertContains(appApi,'canonical-direct-v1','chat mission canonical intake marker missing');
assertContains(appApi,'const mission = direct.b?.mission ?? direct.b?.result ?? null;','chat mission must consume canonical mission result');
assertContains(appApi,'visualState: "mission_queued"','chat mission queued UI state missing');

assertContains(appApi,'path.endsWith("/missions")','mission route missing');
assertContains(appApi,'path.endsWith("/memory/search")','memory search route missing');
assertContains(appApi,'path.endsWith("/media/upload-url")','media upload preparation route missing');
assertContains(appApi,'path.endsWith("/capabilities")','capability catalog route missing');
assertContains(appApi,'model_registry','live model registry must feed capability catalog');
assertContains(appApi,'agent_catalog','live agent registry must feed capability catalog');
assertContains(appApi,'device_registry','live device registry must feed capability catalog');
assertContains(appApi,'aria-capability-catalog-v1','capability catalog version marker missing');
assertContains(appApi,'path.endsWith("/events")','mission event detail route missing');
assertContains(appApi,'function liveAssistantContext(userId:string)','chat must receive live runtime context');
assertContains(appApi,'Estado LIVE del sistema ARIA (fuente operativa)','chat live-state prompt marker missing');
assertContains(appApi,'function missionPhase(m:any)','mission phase model missing');
assertContains(appApi,'phase:missionPhase(m)','mission phase must be exposed to UI');
assertContains(appApi,'from("mission_state")','mission lookup must use the canonical mission_state store');


assertContains(appApi,'aria-app-media','private media bucket missing');
assert.ok(appApi.includes('const objectPath=`${u.id}/${crypto.randomUUID()}/${fileName}`') || appApi.includes('const objectPath=`${user.id}/${crypto.randomUUID()}/${fileName}`'),'media object path is not user-scoped');
assertContains(appApi,'createSignedUploadUrl(objectPath)','signed media upload missing');
assertContains(appApi,'"x-aria-user-id": userId','authenticated user scope not propagated to internal memory/mission boundary');
assertContains(appApi,'recall(text, user.id)','conversation recall must use authenticated user scope');
assertContains(appApi,'target?.provider_id','conversation model provider validation missing');
assertContains(appApi,'target?.account_id','conversation model account validation missing');
assertContains(appApi,'target?.model_id','conversation model id validation missing');
assertContains(appApi,'conversation_model_execution_failed','conversation failure boundary missing');
assertContains(appApi,'conversationRoutes','conversation route catalog missing');
assertContains(appApi,'executeConversationWithFallback','conversation fallback boundary missing');
assertContains(appApi,'input:{payload}','conversation execution payload wrapper missing');
assertContains(appApi,'prompt,max_tokens:512,temperature:0.3','conversation payload must include canonical prompt parameters');
assertContains(appApi,'/v1/meditation/tick-service','Meditation activation must trigger the canonical cloud tick');
assertContains(planner,'aria-planner-v11-runtime-probe-v1','runtime probe planner branch missing');
assertContains(planner,'aria-planner-v11-safe-readonly-fallback-v3-multistep','generic mission planner must use the governed multi-step read-only fallback');
if(planner.includes('steps:[step(1,"file_read","README.md")')) throw new Error('planner must not fall back to unrelated README.md');

assertContains(appApi,'fallback_count','conversation fallback evidence missing');
assertContains(appApi,'aria-execution-runtime-v1','canonical execution runtime missing');
assertContains(appApi,'aria-app-v1','app provenance missing');
if(appApi.includes('SUPABASE_ANON_KEY'))throw new Error('v3 must not depend on legacy anon-key reauthentication');
assertContains(appWorkflow,'supabase functions deploy aria-app-api-v3 --project-ref','app v3 deployment command missing');
if(appWorkflow.includes('--verify-jwt'))throw new Error('app v3 workflow uses removed Supabase CLI verify-jwt flag');
assertContains(memory,'x-aria-user-id','memory user-scope header missing');
assertContains(memory,'aria_memory_search_hybrid_user_scoped','scoped memory search RPC missing');
assertContains(memory,'aria_memory_remember_user_scoped','scoped memory remember RPC missing');
assertContains(memory,"scope:'user'",'memory user-scope result marker missing');
assertContains(planner,'goal.startsWith("IA conversacional:")','conversation-aware planner branch missing');
assertContains(planner,'executor_type:"model"','conversation planner must emit a model executor');
assertContains(planner,'provider_id:route.provider_id','conversation planner provider propagation missing');
assertContains(planner,'account_id:route.account_id','conversation planner account propagation missing');
assertContains(planner,'model_id:route.model_id','conversation planner model propagation missing');
assertContains(planner,'const routes=await modelRoutes();const r=routes[0]','conversation planner live model route selection missing');
assertContains(planner,'aria-planner-v11-conversation-aware','current conversation-aware planner version marker missing');
assertContains(plannerWorkflow,'node tests/aria-app-api-v3-contract.test.js','planner contract gate missing');
assertContains(plannerWorkflow,'supabase functions deploy aria-planner-v11 --project-ref','planner deployment command missing');
if(plannerWorkflow.includes('--verify-jwt'))throw new Error('planner workflow uses removed Supabase CLI verify-jwt flag');
assertContains(executor,'route.provider_id!=="openrouter"','openrouter route guard missing');
assertContains(executor,'route.account_id!=="acct_openrouter_primary"','openrouter account guard missing');
assertContains(executor,'const freeOpenRouterModels=new Set','openrouter free model allowlist missing');
assertContains(executor,'nvidia/nemotron-3-ultra-550b-a55b:free','expanded free model catalog missing');
assertContains(executor,'status:"succeeded"','successful execution contract missing');
if(!plannerConfig.includes('"imports"'))throw new Error('planner v11 deno.json invalid');
console.log('aria-app-api-v3-contract.test.js: PASS');

for (const fragment of [
  "void trackMission(d.mission.mission_id)",
  "Background mission tracking must never block the conversational channel.",
  "function missionResultText(mission: any)",
  "function missionHumanSummary(mission: any)",
  "RESPUESTA / RESULTADO DE ARIA",
  "Qué hizo ARIA",
  "Qué cambió",
  "Qué mejora ahora",
  "EVIDENCIA TÉCNICA",
]) {
  // PWA assertions are mirrored here so the main npm contract gate covers
  // conversational/mission concurrency without requiring a browser runner.
  if (!pwa.includes(fragment)) throw new Error("PWA runtime contract missing: " + fragment);
}
