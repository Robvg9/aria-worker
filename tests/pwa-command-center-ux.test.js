const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');

assert.match(app,/const nextQueuedMission = meditationQueueItems\(o, null\)\[0\]/);
assert.match(app,/const displayMission = m \?\? nextQueuedMission/);
assert.match(app,/MeditationLiveExecution mission=\{displayMission\}/);
assert.match(app,/IDEAS ANALIZADAS/);
assert.match(app,/Ver ideas y crear misión/);
assert.match(app,/ideasOpen &&/);
assert.match(app,/¿Qué es una idea analizada\?/);
assert.match(app,/Crear misión/);

const homeSlice=app.slice(app.indexOf("function Chat("), app.indexOf("function meditationQueueItems("));
assert.match(homeSlice,/homeEssential/);
assert.match(homeSlice,/MISIÓN ACTUAL/);
assert.doesNotMatch(homeSlice,/<OperationalHealthPanel health=\{operationalHealth\} \/>/);

const meditationSlice=app.slice(app.indexOf("function Meditation("), app.indexOf("function executionEventTitle("));
assert.doesNotMatch(meditationSlice,/<OperationalHealthPanel health=\{operationalHealth\} \/>/);
assert.match(meditationSlice,/meditationToolsPanel/);

assert.match(css,/\.homeEssential\{[^}]*overflow:hidden/);
assert.match(css,/\.homeQuickActions\{display:grid/);
assert.match(css,/\.meditationToolsPanel/);
assert.match(css,/\.ideaModal\{width:min\(820px,100%\)/);
assert.match(css,/\.ideaMeaning\{/);

console.log('PWA COMMAND CENTER UX CONTRACT: PASS');
