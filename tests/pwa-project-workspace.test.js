const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const project=fs.readFileSync(path.join(root,'pwa/src/ProjectWorkspace.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
const runner=fs.readFileSync(path.join(root,'supabase/functions/aria-mission-runner-v22/index.ts'),'utf8');
const worker=fs.readFileSync(path.join(root,'worker.js'),'utf8');
const battlecruiserReference=fs.readFileSync(path.join(root,'pwa/public/project-previews/battlecruiser-reference.html'),'utf8');

for(const id of ['battlecruiser','cuevacoin','aria'])assert.match(project,new RegExp(id));
assert.match(app,/ProjectWorkspace/);
assert.match(app,/onProjects/);
assert.match(project,/CHAT EXCLUSIVO/);
assert.match(project,/same queue|misma cola|una sola cola/i);
assert.match(project,/visual_context/);
assert.match(runner,/project_id: typeof mission\?\.metadata\?\.project_id/);
assert.match(runner,/visual_context: mission\?\.metadata\?\.visual_context/);
assert.match(runner,/mission\?\.checkpoint\?\.visual_context/);
for(const tool of ['pen','marker','line','rect','circle','arrow','text','eraser'])assert.match(project,new RegExp("'"+tool+"'"));
assert.match(project,/toBlob/);
assert.match(project,/media\/upload-url/);
assert.match(project,/annotation_summary/);
assert.match(api,/PROJECTS/);
assert.match(api,/project_id/);
assert.match(api,/\/projects\//);
assert.match(api,/attachments/);
assert.match(runner,/function verifyStep/);
assert.match(runner,/explicitlyUnverified/);
assert.match(runner,/verification_failed/);
assert.match(runner,/__aria_verified_by_runner/);
assert.match(css,/visualBoardPanel/);
assert.match(project,/Cargar imagen|Cargar captura de referencia/);
assert.match(project,/conversationId/);
assert.match(project,/\/projects\/.*conversation/);
assert.match(api,/aria_app_persist_message/);
assert.doesNotMatch(api,/aria_app_save_message/);
assert.match(api,/looksLikeSimpleConversation/);
assert.match(api,/multimodal/);
assert.match(api,/createSignedUrl/);
assert.match(api,/const annotations = Array\.isArray\(raw\.annotations\)/);
const projectConstCount=(api.match(/const project = normalizeProjectContext\(body\);/g)||[]).length;
assert.equal(projectConstCount,2);
assert.match(app,/bottomNav/);
assert.match(app,/handleGlobalPointerDown/);
assert.match(app,/handleGlobalPointerUp/);
assert.match(app,/SWIPE_PAGES/);
assert.doesNotMatch(app,/screenIndicator/);
assert.match(app,/conversationId/);
assert.match(app,/pageBodyViewport/);
assert.match(app,/e\.key === 'Enter'/);
assert.match(project,/Lápiz/);
assert.match(project,/PROJECT PREVIEW/);
assert.match(project,/invalid_or_expired_session/);
assert.match(project,/La sesión de ARIA expiró/);
assert.match(project,/previewPaused/);
assert.match(project,/Pausa la vista previa antes de pintar/);
assert.match(project,/project_preview:true/);
assert.match(project,/Crear misión con este diseño/);
assert.match(project,/await onMission/);
assert.match(project,/composerStatus/);
assert.match(project,/projectChatRef/);
assert.match(project,/Marcador/);
assert.match(project,/Borrador/);
assert.doesNotMatch(project,/window\.prompt/);
assert.doesNotMatch(css,/min-width:560px/);
assert.match(css,/height:100dvh/);
assert.match(css,/body\{overflow:hidden/);
assert.match(css,/\.bottomNav/);
assert.match(css,/\.pageBodyViewport/);
assert.match(css,/\.canvasWrap\{overflow:auto/);
assert.match(css,/fileButton/);
assert.doesNotMatch(app,/screenIndicator/);
assert.match(css,/\.visualPreviewControls/);
assert.match(fs.readFileSync(path.join(root,'supabase/migrations/20260922171331_harden_meditation_notification_label_execute.sql'),'utf8'),/revoke execute/i);
console.log('PWA PROJECTS + ARTIA VISUAL + SHARED QUEUE + VERIFICATION CONTRACT: PASS');

assert(project.includes("previewUrl:'https://aria.robvg9.workers.dev/project-preview/battlecruiser/'"));
assert.ok(project.includes("previewUrl:'https://aria.robvg9.workers.dev/project-preview/battlecruiser/', previewMode:'source'"), 'BattleCruiser must use the governed source reference rather than its unauthenticated login screen');
assert.match(worker,/battlecruiser: '\/project-previews\/battlecruiser-reference\.html'/);
assert.match(worker,/url\.pathname==="\/project-preview\/battlecruiser"/);
assert.match(battlecruiserReference,/REFERENCIA VISUAL · BATTLECRUISER/);
assert.match(battlecruiserReference,/no muestra datos LIVE/i);
assert.match(project,/Previsualización de/);
assert.match(project,/<iframe/);
assert.match(project,/pointerEvents:previewPaused\?'none':'auto'/);
console.log('BATTLECRUISER SOURCE REFERENCE + ARTIA CONTRACT: PASS');

assert.match(project,/requestFullscreen/);
assert.match(project,/fullscreenchange/);
assert.match(project,/document\.exitFullscreen/);
assert.match(project,/allow='fullscreen'/);
assert.match(project,/artiaFullscreenExit/);
assert.match(css,/\.artiaPreviewShell:fullscreen/);
console.log('ARTIA FULLSCREEN LIVE PWA CONTRACT: PASS');
assert.match(project,/const up=await api\('\/media\/upload-url'/);
assert.match(project,/if\(!signed\|\|!path\)throw new Error\('ARIA no confirmó la ubicación del diseño.'/);
assert.match(project,/body:blob/);
assert.match(project,/image_path:path/);
assert.match(project,/annotations:actions\.slice\(0,128\)/);
assert.match(project,/mime_type:'image\/png'/);
assert.match(project,/\{type:'file',fileId:path,path,mimeType:'image\/png'/);
assert.match(project,/const livePreviewUrl = project\.previewUrl \|\| null/);
assert.match(project,/previewMode:'source'/);
assert.match(project,/previewUrl:'https:\/\/aria\.robvg9\.workers\.dev\/project-preview\/cuevacoin\//);
assert.match(project,/previewUrl:'https:\/\/aria\.robvg9\.workers\.dev\/project-preview\/aria\//);
assert.doesNotMatch(project,/No hay una PWA LIVE configurada para este proyecto/);
assert.match(project,/REFERENCIA VISUAL · ESTRUCTURA REAL · NO LIVE/);
assert.match(project,/REFERENCIA VISUAL · CÓDIGO REAL · main · NO LIVE/);
assert.match(project,/PROJECT REFERENCE/);
assert.match(project,/CuevaCoin/);
assert.match(project,/CuevaCoin\.\s*'Panel financiero|Panel financiero\/operativo/);
assert.match(project,/ARIA\.\s*'Centro cognitivo|Centro cognitivo de referencia/);
assert.match(project,/Referencia visual del proyecto/);
assert.doesNotMatch(project,/fillText\('LIVE PREVIEW'/);

assert.match(project,/if\(!livePreviewUrl\)/);
assert.match(project,/canvas must remain transparent|The canvas must remain transparent/i);
assert.match(project,/Fuente LIVE configurada/);
assert.match(project,/Referencia visual local del proyecto/);
assert.match(project,/pointerEvents:previewPaused\?'none':'auto'/);



const projectApi = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'aria-app-api-v3', 'index.ts'), 'utf8');
assert.ok(projectApi.includes('.eq("metadata->>project_id", project.id)'), 'project missions must filter by project in Postgres');
assert.ok(projectApi.includes('.order("updated_at", { ascending: false }).limit(limit)'), 'project missions must use bounded ordered query');
assert.ok(projectApi.includes('enrichMission(m, sb, false)'), 'project mission list must skip ETA fanout');
const projectIndexMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260929124500_project_mission_query_index_v1.sql'),
  'utf8',
);
assert.ok(projectIndexMigration.includes('mission_state_project_updated_idx'));
assert.ok(projectIndexMigration.includes("(metadata ->> 'project_id')"));

assert.ok(project.includes("if(tab==='missions'||tab==='overview')void loadMissions();"));
assert.ok(project.includes("if(tab==='chat'||tab==='visual')void loadProjectChat();"));
assert.ok(project.includes("setInterval(refresh,15000)"));
assert.ok(!project.includes("void loadMissions();void loadProjectChat()"));
assert.ok(!project.includes("setInterval(refresh,5000)"));

assert.ok(project.includes("setSelectedMission(null);setError('');setProjectChatReady(false);"));
assert.ok(project.includes("aria_project_missions"), 'project missions must consume the global preload cache');
assert.ok(project.includes("projectChatReady"), 'project chat readiness state must exist');
assert.ok(project.includes("function ProjectOverviewPreview"), 'project overview must expose a real preview surface');
assert.ok(project.includes("aria-label={'Previsualización de '+project.name}"), 'project preview must identify the selected project');
assert.ok(project.includes("onLoad={()=>setLoadState('loaded')}"), 'project preview must record successful iframe load');
assert.ok(project.includes("No hay fuente de previsualización configurada"), 'project preview must fail clearly when no source exists');
assert.ok(project.includes("setActions([]);") && project.includes("[project.id]"), 'ARTIA drawing state must reset when changing project');
assert.ok(project.includes("disabled={sending||!text.trim()||!projectChatReady}"), 'project chat send must wait for ready conversation');
assert.ok(project.includes("Cargando conversación"), 'project chat must expose loading state');

const missionEventsIndexMigration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260929130000_mission_events_hotpath_index_v1.sql'),
  'utf8',
);
assert.ok(missionEventsIndexMigration.includes('mission_events_type_created_idx'));
assert.ok(missionEventsIndexMigration.includes('(event_type, created_at desc)'));

assert.ok(project.includes("drawingActionRef"));
assert.ok(project.includes("drawingPointsRef"));
assert.ok(project.includes("const points=['pen','marker','eraser'].includes(tool)?[...drawingPointsRef.current]:[startPoint.current||p,p]"));
assert.ok(project.includes("drawingActionRef.current=a.length"));

const projectE2E = fs.readFileSync(path.join(root, 'rwht/pc-browser/rwht-projects-e2e.mjs'), 'utf8');
assert.match(projectE2E,/internalHosts = new Set/);
assert.match(projectE2E,/artia_canvas_not_ready/);
assert.ok(projectE2E.includes("canonical project-mission list"), 'ARTIA E2E must use canonical server read-back instead of trusting a browser response listener');
assert.ok(projectE2E.includes("visual_mission_submission_failed_"), 'ARTIA E2E must distinguish UI-reported failure from success');
assert.ok(project.includes("async function createMission(payload:any={}):Promise<boolean>"), 'project mission creation must expose an explicit success result');
assert.ok(project.includes("if(result!==true)throw new Error('ARIA no confirmó la creación de la misión."), 'ARTIA must not display success when mission creation failed');
assert.ok(project.includes("return false}finally{setSending(false)}"), 'mission creation failures must be propagated to ARTIA');
assert.ok(projectE2E.includes("/Anotaciones:\\s*[1-9]\\d*/"));
assert.match(projectE2E,/await waitFor\(500\)/);
assert.ok(projectE2E.includes("const overviewPreviewResults = report.overview_preview_results;"), 'E2E must persist overview previews incrementally even if a later step fails');
assert.ok(projectE2E.includes("const visualMissions = report.visual_missions;"), 'E2E must retain partial visual mission evidence on failure');
assert.ok(projectE2E.includes("const previewResults = report.preview_results;"), 'E2E must retain partial ARTIA preview evidence on failure');
assert.ok(project.includes('async function waitForProjectAssistant('),'project chat must poll canonical conversation when an async executor is accepted');
assert.ok(project.includes('if(d?.processing===true)'),'project chat must handle background local-executor responses');
assert.ok(project.includes('assistantAfterLatestUser'),'project chat polling must wait for an assistant answer after the latest user turn');

assert.match(projectE2E,/window\.top !== window/,'RWHT auth bootstrap must skip sandboxed embedded preview frames');
assert.match(projectE2E,/localStorage\.setItem\('aria_session_v2',[\s\S]{0,250}catch \{/,'RWHT must fail safely when localStorage is unavailable in an embedded frame');
assert.ok(projectE2E.includes("const fresh = await signInViaAuthApi()"), 'RWHT must retry API authentication once when a persisted session is stale');
assert.ok(projectE2E.includes("auth_provider_unavailable_no_login_form_after_api_recovery"), 'RWHT must distinguish upstream auth outage from a missing UI login form');
assert.ok(projectE2E.includes("stale_local_session_detected: Boolean(stored?.accessToken)"), 'RWHT evidence must report stale session recovery attempts');
assert.ok(projectE2E.includes("Number(report.login?.attempts || 0)"), 'RWHT must correctly persist the numeric auth attempt count');
const plannerSource = fs.readFileSync(path.join(root, 'supabase/functions/aria-planner-v11/index.ts'), 'utf8');
assert.match(plannerSource, /function visualProjectMissionPlan\(goal:string,context:any\)/);
const visualRouteIndex = plannerSource.indexOf('const visualProjectMission=visualProjectMissionPlan');
const battleCruiserAuditIndex = plannerSource.indexOf('const battlecruiserAudit=await battlecruiserReadonlyAuditPlan');
assert.ok(visualRouteIndex >= 0 && battleCruiserAuditIndex >= 0 && visualRouteIndex < battleCruiserAuditIndex, 'ARTIA visual mission route must precede BattleCruiser read-only audit routing');
assert.match(plannerSource, /visual_project_mission:true/);
assert.match(plannerSource, /visual_project_certification_probe:true/);
assert.match(plannerSource, /visual_project_implementation/);
assert.match(plannerSource, /source_read_before_any_change:true/);
assert.match(plannerSource, /independent_verification_required:true/);
assert.match(plannerSource, /non_main_branch_required:true/);

assert.ok(project.includes("setGoal('');void loadMissions();setTimeout(()=>void loadMissions(),1200);"));
assert.ok(!project.includes("setGoal('');selectTab('missions');void loadMissions();setTimeout(()=>void loadMissions(),1200);"));
const appPreloaderGuard = fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
assert.match(appPreloaderGuard,/if \(page === 'projects'\) return;/);
assert.match(appPreloaderGuard,/PwaDataPreloader session=\{session\} page=\{page\}/);

const appCurrent = fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
assert.match(appCurrent,/replan_required/);
assert.match(appCurrent,/1 · REPLANIFICANDO/);
assert.match(appCurrent,/REPLANIFICANDO/);
const apiCurrent = fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
assert.match(apiCurrent,/activeRecoveryStatuses/);
assert.match(apiCurrent,/replan_learning_application/);
