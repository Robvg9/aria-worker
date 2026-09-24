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
