const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');

assert.match(app,/AppPage = 'aria'.*'settings'/);
assert.match(app,/case '#settings'/);
assert.match(app,/function GlobalBottomNav/);
assert.match(app,/navigation.page === 'projects'/);
assert.match(app,/navigation.page === 'meditation'/);
assert.match(app,/navigation.page === 'capabilities'/);
assert.match(app,/navigation.page === 'settings'/);
assert.match(app,/page === 'settings'\s*\?/);
assert.match(app,/<GlobalBottomNav/);
assert.match(app,/handleGlobalPointerUp/);
assert.match(app,/SWIPE_PAGES/);

assert.doesNotMatch(app,/screenIndicator/);
assert.doesNotMatch(app,/aria_capabilities_tab_v2:'\+session\.userId/);
assert.match(app,/Borrar caché y recargar/);
assert.match(app,/Animaciones/);
assert.match(app,/Notificaciones de ARIA/);
assert.match(app,/Cerrar sesión/);
assert.match(app,/aria_ui_preferences_v1/);
assert.match(app,/function clearCache\(\)/);
assert.match(app,/function togglePref\(key: keyof UiPrefs\)/);
assert.match(app,/function updateApp\(\)/);
console.log('CONFIG SETTINGS CONTRACT: PASS');
assert.match(app,/Actualizar app/);
assert.match(app,/caches.keys()/);
assert.match(app,/sessionSnapshot/);
console.log('GLOBAL NAV + SETTINGS CONTRACT: PASS');

assert.doesNotMatch(app,/function Chat\([\s\S]{0,180}\bonSignOut/);
assert.doesNotMatch(app,/function Chat\([\s\S]{0,7000}<button className='ghost' onClick=\{onSignOut\}>Salir<\/button>/);
assert.doesNotMatch(app,/ARIA \/ CONTINUIDAD.*MEDITACIÓN IA.*Ejecución autónoma, verificación y Human Gates/);
assert.match(app,/function Meditation\(\{ session \}: \{ session: Session \}\)/);
assert.match(app,/<small>Medita<\/small>/);
assert.match(app,/<small>Cap\.<\/small>/);
assert.match(app,/<small>Config\.<\/small>/);
assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
assert.match(css,/\.bottomNav button\{width:100%;min-width:0;/);
console.log('PWA UI CLEANUP CONTRACT: PASS');

const presentation=fs.readFileSync(path.join(root,'pwa/src/missionPresentation.ts'),'utf8');
assert.match(app,/Ver evidencia técnica/);
assert.match(app,/Ocultar evidencia técnica/);
assert.match(app,/missionHumanTitle/);
assert.match(app,/missionListLabel/);
assert.match(presentation,/Integración con BattleCruiser/);
assert.match(presentation,/Diagnóstico de acceso y credenciales/);
assert.match(css,/\.technicalToggle/);
assert.match(css,/\.settingsOption/);
console.log('MISSION PRESENTATION + COLLAPSIBLE EVIDENCE CONTRACT: PASS');

console.log('GLOBAL NAV CURRENT BRANCH CONTRACT: PASS');

assert.match(app,/preferredKeys = \['summary_1', 'crosscheck_1', 'facts_1'\]/);
assert.match(app,/retryexhaustedreplanned/);
assert.match(app,/Reintentar misión/);
assert.match(app,/Cómo solucionarlo/);
assert.match(app,/recoveryPanel/);
assert.match(app,/Abrir recurso relacionado/);
console.log('HUMAN MISSION RESULT + RECOVERY UI CONTRACT: PASS');

assert.match(app,/const SWIPE_PAGES = \['#home', '#chat', '#projects', '#meditation', '#capabilities', '#settings'\]/);
assert.match(app,/globalSwipeStartRef/);
assert.doesNotMatch(app,/className='swipeNav'/);
assert.doesNotMatch(app,/swipeHint/);
assert.doesNotMatch(css,/Visible Dashboard\/Chat gesture hint/);
assert.match(app,/executionHumanNow/);
assert.match(app,/executionHumanLog/);
assert.match(app,/executionOutcome/);
assert.match(app,/Última actividad/);
assert.match(app,/Actualizando…/);
assert.match(app,/live_events/);
assert.doesNotMatch(app,/ACTIVIDAD REAL/);
assert.doesNotMatch(app,/ESTADO PERSISTIDO/);
assert.doesNotMatch(app,/executionTelemetryGrid/);
assert.doesNotMatch(app,/SINCRONIZANDO…/);
assert.doesNotMatch(app,/0\.0%/);

assert.doesNotMatch(app,/document\.addEventListener\('touchstart'/);
assert.doesNotMatch(app,/document\.addEventListener\('touchend'/);
assert.doesNotMatch(app,/document\.addEventListener\('touchcancel'/);
assert.doesNotMatch(app,/document\.addEventListener\('touchmove'/);
assert.match(app,/globalSwipeTriggeredRef/);
assert.match(app,/Math\.abs\(dx\) < 32/);
assert.match(app,/Math\.abs\(dx\) < 42/);
assert.match(app,/meditationQueueItems/);
assert.match(app,/\/meditation\/queue\/reorder/);
assert.doesNotMatch(app,/Cancelar ejecución/);
assert.match(app,/Cancelar misión/);
assert.match(app,/live_events/);

assert.match(css,/\.chatPanel \.chatWindow[^\n]*touch-action:pan-y/);
assert.match(css,/\.pageBodyViewport[^\n]*touch-action:pan-y/);
assert.match(css,/\.projectBodyViewport[^\n]*touch-action:pan-y/);

assert.match(app,/document\.addEventListener\('pointerdown'/);
assert.match(app,/document\.addEventListener\('pointermove'/);
assert.match(app,/document\.addEventListener\('pointerup'/);

assert.match(app,/CHAT_HISTORY_KEY_PREFIX = 'aria-chat-history-v1'/);
assert.match(app,/function readChatHistory\(userId: string\)/);
assert.match(app,/function writeChatHistory\(/);
assert.match(app,/setPendingMissionConfirmation/);
assert.match(app,/mission_confirmation_required/);
assert.match(app,/confirmPendingMission/);
assert.match(app,/No, solo conversar/);
assert.match(app,/Sí, comenzar misión/);
assert.match(css,/.pageBodyViewport>\.executionHero\{flex:0 0 auto/);
assert.match(css,/.meditationViewport>\.executionHero\{flex:0 0 auto!important/);
assert.match(css,/.missionConfirmation\{/);
console.log('CHAT PERSISTENCE + MOBILE MEDITATION + MISSION CONFIRMATION CONTRACT: PASS');


assert.match(app,/const active = selectLiveMission\(missionsResult\)/,'Dashboard/Chat must use the canonical live-mission selector instead of trusting an arbitrary active_mission payload.');
assert.match(app,/only an actively leased RUNNING\/WAITING mission belongs in the/,'Dashboard live-state rule must remain documented at the source.');
assert.doesNotMatch(app,/const active = missionsResult\?\.active_mission;\s*setMission\(active \?\? null\)/,'Dashboard must not surface stale/queued active_mission directly.');
console.log('DASHBOARD LIVE MISSION SSoT CONTRACT: PASS');
