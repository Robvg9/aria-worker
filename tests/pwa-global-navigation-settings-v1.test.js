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
assert.doesNotMatch(css,/Visible Dashboard\\/Chat gesture hint/);
assert.match(app,/ACTIVIDAD REAL/);
assert.match(app,/ESTADO PERSISTIDO/);
assert.match(app,/latestEventFresh/);
assert.match(app,/No se inferirá actividad actual sin un evento reciente/);
assert.match(app,/collapsiblePanel/);
assert.match(app,/executionTelemetryGrid/);

assert.doesNotMatch(app,/document\.addEventListener\('touchstart'/);
assert.doesNotMatch(app,/document\.addEventListener\('touchend'/);
assert.doesNotMatch(app,/document\.addEventListener\('touchcancel'/);
assert.doesNotMatch(app,/document\.addEventListener\('touchmove'/);
assert.match(app,/globalSwipeTriggeredRef/);
assert.match(app,/Math\.abs\(dx\) < 32/);
assert.match(app,/Math\.abs\(dx\) < 42/);
assert.match(app,/meditationQueueItems/);
assert.match(app,/\/meditation\/queue\/reorder/);
assert.match(app,/Cancelar ejecución/);
assert.match(app,/live_events/);

assert.match(css,/\.chatPanel \.chatWindow[^\n]*touch-action:pan-y/);
assert.match(css,/\.pageBodyViewport[^\n]*touch-action:pan-y/);
assert.match(css,/\.projectBodyViewport[^\n]*touch-action:pan-y/);

assert.match(app,/document\.addEventListener\('pointerdown'/);
assert.match(app,/document\.addEventListener\('pointermove'/);
assert.match(app,/document\.addEventListener\('pointerup'/);
