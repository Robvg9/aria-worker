const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const project=fs.readFileSync(path.join(root,'pwa/src/ProjectWorkspace.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
const runner=fs.readFileSync(path.join(root,'supabase/functions/aria-mission-runner-v22/index.ts'),'utf8');

for(const id of ['battlecruiser','cuevacoin','aria'])assert.match(project,new RegExp(id));
assert.match(app,/ProjectWorkspace/);
assert.match(app,/onProjects/);
assert.match(project,/CHAT EXCLUSIVO/);
assert.match(project,/same queue|misma cola|una sola cola/i);
assert.match(project,/visual_context/);
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

assert(project.includes("previewUrl:'https://battlecruiser.robvg9.workers.dev/"));
assert.match(project,/PWA LIVE de/);
assert.match(project,/<iframe/);
assert.match(project,/pointerEvents:previewPaused\?'none':'auto'/);
console.log('BATTLECRUISER LIVE PWA ARTIA CONTRACT: PASS');

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
assert.ok(projectE2E.includes("return /Anotaciones:\\s*[1-9]\\d*/.test(text);"));
assert.match(projectE2E,/setTimeout\(resolve, 250\)/);

assert.ok(project.includes("setGoal('');void loadMissions();setTimeout(()=>void loadMissions(),1200);"));
assert.ok(!project.includes("setGoal('');selectTab('missions');void loadMissions();setTimeout(()=>void loadMissions(),1200);"));
