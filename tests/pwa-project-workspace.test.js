const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const project=fs.readFileSync(path.join(root,'pwa/src/ProjectWorkspace.tsx'),'utf8').replace(/\r\n/g,'\n');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
const runner=fs.readFileSync(path.join(root,'supabase/functions/aria-mission-runner-v22/index.ts'),'utf8');
const worker=fs.readFileSync(path.join(root,'worker.js'),'utf8');
const battlecruiserReference=fs.readFileSync(path.join(root,'pwa/public/project-previews/battlecruiser-reference.html'),'utf8');
const projectsRwht=fs.readFileSync(path.join(root,'rwht/pc-browser/rwht-projects-e2e.mjs'),'utf8').replace(/\r\n/g,'\n');

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

assert(project.includes("previewUrl:'https://battlecruiser.robvg9.workers.dev/'"));
assert.ok(project.includes("previewUrl:'https://battlecruiser.robvg9.workers.dev/', previewMode:'auth-required'"), 'ARTIA must embed the canonical LIVE BattleCruiser frontend and state that a user session is required');
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
assert.match(project,/const projectChatReadGenerationRef=useRef\(0\)/,'project chat reads must be generation-scoped');
assert.match(project,/const projectChatWriteInFlightRef=useRef\(false\)/,'a new server read must not surface a timeout as a chat failure while a write is processing');
assert.ok(project.includes("!options.quiet&&!projectChatWriteInFlightRef.current"), 'transient conversation read errors are suppressed only during an active chat write');
assert.ok(project.includes("if(!clean||sending||projectChatWriteInFlightRef.current)return;"), 'chat send is idempotently guarded against overlapping submissions');
assert.ok(project.includes("finally{projectChatWriteInFlightRef.current=false;setSending(false)}"), 'chat write state is always released');
assert.ok(project.includes("readGeneration!==projectChatReadGenerationRef.current"), 'a stale chat read must not overwrite a later send or project selection');
assert.ok(project.includes("projectChatReadGenerationRef.current+=1;"), 'sending a new turn must invalidate older conversation reads');
assert.ok(project.includes("projectChatLoadRef.current?.promise===promise"), 'an older load must not clear a newer in-flight read');
assert.ok(project.includes("async function loadProjectChat(options:{quiet?:boolean}={})"), 'chat refresh must support non-fatal best-effort mode after a verified response');
assert.ok(project.includes("await loadProjectChat({quiet:true});"), 'a secondary chat refresh must not invalidate the already verified response');
assert.ok(project.includes("if(!options.quiet&&!projectChatWriteInFlightRef.current)setError("), 'quiet read failure must not surface as a false chat runtime error, and active chat writes must suppress competing read timeouts');
assert.ok(project.includes("setError('');\n        try{localStorage.setItem('aria_project_conversation:"), 'a successful canonical chat read must clear a stale read error');
assert.ok(project.includes("function ProjectOverviewPreview"), 'project overview must expose a real preview surface');
assert.ok(project.includes("data-project-id={project.id} data-preview-mode={mode}"), 'project overview must expose the exact project identity and truth boundary for E2E verification');
assert.ok(project.includes("d?.mission?.mission_id??d?.mission_id??d?.result?.mission_id"), 'project mission intake must accept both canonical nested and top-level mission acknowledgements');
assert.ok(project.includes("const createdMissionId=String("), 'project mission intake must normalize the canonical mission ID before confirming success');
assert.ok(project.includes("respuesta sin identificador canónico"), 'mission creation failure must explain that no canonical ID was returned rather than hiding the response cause');
assert.ok(project.includes("href='/pwa/reality-board.html'"), 'project overview must provide a direct entry to the separate Reality Board app');
assert.ok(project.includes('¿Qué falta por cerrar?'), 'Reality Board entry must explain its purpose in human language');
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
const projectsRwhtWorkflow = fs.readFileSync(path.join(root, '.github/workflows/projects-rwht-authenticated.yml'), 'utf8');
const overviewProbeIndex = projectsRwhtWorkflow.indexOf('Verify Meditation IA overview runtime and database contract on LIVE');
const authenticatedE2EIndex = projectsRwhtWorkflow.indexOf('Execute authenticated Projects + ARTIA E2E');
assert.ok(overviewProbeIndex >= 0 && authenticatedE2EIndex > overviewProbeIndex, 'Projects + ARTIA E2E must first prove authenticated Meditation overview/database is ready on LIVE');
assert.ok(projectsRwhtWorkflow.includes("request('/api/meditation/overview', session.accessToken"), 'overview preflight must use the authenticated Worker proxy path followed by the PWA');
assert.match(projectsRwhtWorkflow,/group:\s*aria-projects-artia-rwht-\$\{\{\s*github\.event_name/,'Projects ARTIA RWHT must isolate concurrency by deployed SHA so a stalled old run cannot block a new release');
assert.ok(projectsRwhtWorkflow.includes('timeout-minutes: 8') && projectsRwhtWorkflow.includes('name: Install Chromium'),'Chromium installation must have a bounded step timeout');

assert.match(projectE2E,/internalHosts = new Set/);
assert.match(projectE2E,/artia_canvas_not_ready/);
assert.ok(projectE2E.includes("canonical project-mission list"), 'ARTIA E2E must use canonical server read-back instead of trusting a browser response listener');
assert.ok(projectE2E.includes("visual_mission_submission_failed_"), 'ARTIA E2E must distinguish UI-reported failure from success');
assert.ok(project.includes("async function createMission(payload:any={}):Promise<boolean>"), 'project mission creation must expose an explicit success result');
assert.ok(project.includes("path==='/missions'?120000:30000"), 'canonical visual mission intake must tolerate the observed ~40-second backend latency without a false timeout');
assert.ok(project.includes("const createMissionRequestRef=useRef<{key:string;requestId:string}|null>(null)"), 'uncertain visual mission submissions must keep a stable idempotency request id for retries');
assert.ok(project.includes("headers:{'x-aria-request-id':request.requestId}"), 'visual mission submissions must pass their stable request id through the Worker proxy');
assert.ok(project.includes('createMissionRequestRef.current=null'), 'the idempotency key must be cleared only after a canonical mission id is confirmed');
assert.ok(project.includes("if(result!==true)throw new Error('ARIA no confirmó la creación de la misión."), 'ARTIA must not display success when mission creation failed');
assert.ok(project.includes("return false}finally{setSending(false)}"), 'mission creation failures must be propagated to ARTIA');
assert.ok(projectE2E.includes("/Anotaciones:\\s*[1-9]\\d*/"));
assert.match(projectE2E,/await waitFor\(500\)/);
assert.ok(projectE2E.includes("const overviewPreviewResults = report.overview_preview_results;"), 'E2E must persist overview previews incrementally even if a later step fails');
assert.ok(projectE2E.includes("const selectedBeforeFinalReload ="), 'final reload verification must capture the actual selected project before navigation');
assert.ok(projectE2E.includes("report.final_selected_project = expectedSelectedProject.id;"), 'E2E evidence must disclose which project selection was preserved');
assert.ok(projectE2E.includes("projectName: expectedSelectedProject.name"), 'final reload check must match the selection it just observed, not a stale hard-coded project');
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


// BattleCruiser is a separate first-class resource binding; it must never reuse ARIA's backend.
assert.match(apiCurrent,/backend_project_ref: "papxnkkjtkxsitcsvcme"/);
assert.match(apiCurrent,/backend_api_url: "https:\/\/papxnkkjtkxsitcsvcme\.supabase\.co"/);
assert.match(apiCurrent,/backend_dashboard_url: "https:\/\/supabase\.com\/dashboard\/project\/papxnkkjtkxsitcsvcme"/);
assert.match(apiCurrent,/frontend_live_url: "https:\/\/battlecruiser\.robvg9\.workers\.dev\//);
assert.match(apiCurrent,/repository_url: "https:\/\/github\.com\/Robvg9\/battlecruiser\/tree\/main"/);
assert.match(apiCurrent,/backend_access_state: "requires_authorized_authenticated_context"/);
assert.match(apiCurrent,/resources: project\.resources/);
assert.match(apiCurrent,/The ARIA project ref icuqsstxfdbvjytkhlog never substitutes for BattleCruiser|El Supabase de ARIA \(icuqsstxfdbvjytkhlog\) nunca sustituye al de BattleCruiser/);
assert.match(project,/https:\/\/github\.com\/Robvg9\/battlecruiser\/tree\/main/);
assert.match(project,/https:\/\/battlecruiser\.robvg9\.workers\.dev\//);
assert.match(project,/papxnkkjtkxsitcsvcme/);
console.log('ARIA BATTLECRUISER CANONICAL PROJECT RESOURCE BINDING: PASS');

assert.ok(project.includes('FUENTES CANÓNICAS · {project.name.toUpperCase()}'), 'BattleCruiser source links must show the selected project heading');
assert.match(project,/Frontend LIVE ↗/);
assert.match(project,/Código · main ↗/);
assert.match(project,/Backend · Supabase ↗/);
assert.match(project,/la conexión de Supabase de ARIA/i);
console.log('BATTLECRUISER PROJECT LINKS ARE VISIBLE WITHOUT CLAIMING BACKEND AUTH: PASS');

assert.ok(apiCurrent.includes("const projectConnectionsPath = path.match"), 'ARIA API must expose an authenticated, project-scoped connection health endpoint');
assert.ok(apiCurrent.includes('fetchBounded(frontendUrl + "/app.js")'), 'connection health must probe the actual deployed BattleCruiser app');
assert.ok(apiCurrent.includes('fetchBounded(frontendUrl + "/js/core.js")'), 'connection health must read the deployed frontend config to verify the backend project identity');
assert.ok(apiCurrent.includes('backend_data: { status: "not_checked_requires_authenticated_context", verified: false'), 'health probes must not claim protected data access without an authenticated BC session');
assert.ok(apiCurrent.includes('configuredBackendUrl !== backendUrl'), 'the connection check must reject a frontend configured to a different Supabase project');
assert.match(project,/api\('\/projects\/'.*\/connections/);
assert.match(project,/ProjectResourceConnections/);
assert.match(project,/BACKEND AUTH/);
assert.match(project,/DATOS PROTEGIDOS/);
console.log('BATTLECRUISER CONNECTION HEALTH GATE IS READ-ONLY AND FAILS CLOSED: PASS');

assert.match(project,/Conectar sesión autenticada de BattleCruiser/i);
assert.doesNotMatch(project,/obtener_email_login_por_nombre/);
assert.match(project,/Correo electrónico de BattleCruiser/);
assert.match(project,/La búsqueda por nombre de usuario está restringida por los permisos actuales de BattleCruiser/);
assert.match(project,/auth\/v1\/token\?grant_type=password/);
assert.match(project,/x-battlecruiser-access-token/);
assert.match(project,/La contraseña se envía desde este navegador directamente al Auth de BattleCruiser/);
assert.match(project,/activeBattleCruiserConnection=null/);
assert.match(apiCurrent,/projectConnectionVerifyPath/);
assert.match(apiCurrent,/battlecruiser_session_invalid/);
assert.match(apiCurrent,/perfil_usuario_actual/);
assert.match(apiCurrent,/permisos_usuario_actual/);
assert.match(apiCurrent,/battleCruiserLiveUserContext/);
assert.match(apiCurrent,/token_persisted: false/);
assert.match(apiCurrent,/mutations_performed: false/);
assert.ok(!apiCurrent.includes('SUPABASE_ANON_KEY'), 'ARIA API must not depend on the legacy anon-key reauthentication flow');
console.log('BATTLECRUISER USER-BOUND SESSION + READ-ONLY CONTEXT CONTRACT: PASS');





// Keep the BattleCruiser user session scoped, ephemeral and attached to the exact project operations.
assert.match(project,/isBattleCruiserMissionIntake=path==='\/missions'&&requestBodyText\.includes\('\"project_id\":\"battlecruiser\"'\)/);
assert.match(project,/void connectBattleCruiserAccount\(\)/);
assert.match(project,/ariaUserId:session\.userId/);
assert.match(project,/current\.ariaUserId/);
assert.ok(project.includes('function ariaUserIdFromAccessToken(token:string):string|null'), 'BattleCruiser session ownership must be derived from the active ARIA token');
assert.match(project,/current\.ariaUserId!==ariaUserId/);
assert.match(project,/getActiveBattleCruiserAccessToken\(ariaUserIdFromAccessToken\(token\)\)/);
assert.match(project,/event\.target\.value/);
assert.match(project,/activeBattleCruiserConnection\?\.ariaUserId===session\.userId/);
assert.ok(apiCurrent.includes(String.raw`path.match(/\/projects\/([^/]+)\/connections\/verify$/)`), 'BattleCruiser session verify route must use a valid path-matching expression');
assert.ok(apiCurrent.includes(String.raw`configText.match(/SUPABASE_URL\s*=\s*["']([^"']+)["']/)`), 'BattleCruiser live context must parse the expected backend URL correctly');
assert.match(project,/if\(isBattleCruiserChat\|\|isBattleCruiserMissionIntake\|\|isBattleCruiserProjectMissions\)/);
console.log('BATTLECRUISER SESSION LIFECYCLE + MISSION CONTEXT CONTRACT: PASS');


// BattleCruiser Projects now uses the canonical LIVE site, with truthful auth-required mode.
assert.ok(project.includes("workspace.scrollTop=0"), 'entering Projects must reset its own scroll container');
assert.ok(project.includes("appFrame.scrollTop=0"), 'entering Projects must reset the app-frame scroll container');
assert.ok(project.includes("document.documentElement.scrollTop=0")&&project.includes("document.body.scrollTop=0")&&project.includes("window.scrollTo(0,0)"), 'entering Projects must reset every document scroll root');
assert.ok(project.includes("initialViewportResetDoneRef")&&project.includes("resetAfterInitialConnectionLayout")&&project.includes("window.requestAnimationFrame(()=>window.requestAnimationFrame("), 'the viewport must be reset after the async connection panel has finished changing layout');
assert.ok(css.includes(".projectShell{max-width:1240px;overflow-anchor:none}"), 'the fixed-height Projects shell must disable browser scroll anchoring that shifts project cards during async panel loading');
assert.ok(projectsRwht.includes("project_shell_scroll_top")&&projectsRwht.includes("first_project_card_top"), 'the Projects E2E artifact must preserve scroll diagnostics if the viewport regression recurs');
assert.ok(projectsRwht.includes('viewport_height: viewportHeight')&&projectsRwht.includes('Number(report.ux.project_tabs_bottom) > Number(report.ux.viewport_height)'), 'the Node-side RWHT gate must use viewport metrics returned by page.evaluate, never the browser-only window global');
assert.ok(!projectsRwht.includes("Number(report.ux.project_tabs_bottom) > window.innerHeight"), 'the final PC RWHT must not reference window in Node scope');
assert.ok(projectsRwht.includes("project_shell_overflow_anchor: getComputedStyle(root).overflowAnchor")&&projectsRwht.includes("projects_scroll_anchor_contract_failed"), 'the real-browser E2E must assert computed scroll-anchor policy and exact project-card viewport position');
assert.ok(projectsRwht.includes("active_element_inside_project_shell"), 'if viewport drift recurs, the E2E report must include the active-focus target to distinguish focus scrolling from layout shifts');
assert.ok(projectsRwht.includes("src: 'https://battlecruiser.robvg9.workers.dev/'"), 'Projects/ARTIA RWHT must target the real BattleCruiser LIVE frontend');
assert.ok(projectsRwht.includes("mode: 'auth-required'"), 'RWHT must certify the LIVE preview auth-required boundary, not a source mock');
assert.ok(!projectsRwht.includes("https://aria.robvg9.workers.dev/project-preview/battlecruiser/"), 'RWHT must not require the obsolete static BattleCruiser reference');
assert.ok(projectsRwht.includes("artia_visual_auth_required_badge_missing_") && projectsRwht.includes("artia_auth_required_badge_missing_"), 'both ARTIA visual missions and preview catalog must verify the auth-required badge');
assert.match(projectsRwht,/const CERT_SCOPE = String\(process\.env\.RWHT_CERT_SCOPE/);
assert.match(projectsRwht,/reality_board_live_sha_mismatch_expected_/);
assert.match(projectsRwht,/projects\.every\(\(project\) => project\.chat\?\.server_persistence_verified === true && project\.chat\?\.reload_persistence_verified === true\)/);
assert.match(projectsRwht,/report\.steps_7_8 =/);
console.log('BATTLECRUISER LIVE PREVIEW + PROJECTS VIEWPORT REGRESSION CONTRACT: PASS');


// Project navigation must be visible before long BattleCruiser connection content, which belongs in the inner scroll region.
const projectReturn=project.slice(project.indexOf("return <main className='appShell projectShell'>"));
const selectorIndex=projectReturn.indexOf("className='projectGrid'");
const tabsIndex=projectReturn.indexOf("className='capTabs projectTabs'");
const connectionIndex=projectReturn.indexOf("ProjectResourceConnections");
const viewportIndex=projectReturn.indexOf("className='projectBodyViewport'");
assert.ok(selectorIndex>=0 && tabsIndex>selectorIndex && connectionIndex>tabsIndex && viewportIndex>tabsIndex, 'project selector and tabs must precede the long BC connections pane');
assert.ok(viewportIndex>tabsIndex && connectionIndex>viewportIndex, 'BC connections must be owned by the scrollable project body, not placed above tabs');
assert.ok(projectsRwht.includes("projects_tabs_must_remain_visible"), 'RWHT must keep project section tabs in the initial viewport');
assert.ok(projectsRwht.includes("projects_body_viewport_must_own_scrolling") && projectsRwht.includes("insideScrollableBody"), 'RWHT must distinguish reachable controls inside the intentional inner scroll area from inaccessible top-level controls');
console.log('PROJECT NAVIGATION VISIBLE + SCROLLABLE BODY LAYOUT CONTRACT: PASS');


// Badge text is authored uppercase in the product UI; the E2E contract must compare the semantic label case-insensitively.
assert.ok(projectsRwht.includes("visualBadge.innerText()).toLowerCase().includes('requiere sesión')"), 'ARTIA visual-mission auth-required assertion must accept the product badge regardless of text case');
assert.ok(projectsRwht.includes("badge.innerText()).toLowerCase().includes('requiere sesión')"), 'ARTIA overview preview auth-required assertion must accept the product badge regardless of text case');
assert.ok(!projectsRwht.includes("innerText()).includes('requiere sesión')"), 'no case-sensitive lowercase-only auth-required badge assertion may remain');
console.log('ARTIA AUTH-REQUIRED BADGE CASE-INSENSITIVE CONTRACT: PASS');
