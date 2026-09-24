const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');

assert.match(app,/api\('\/meditation\/overview'.*api\('\/capabilities'/s);
assert.match(app,/\.catch\(\(\) => null\)/);
assert.match(app,/Parte de Meditación IA se sincronizó/);
assert.match(app,/Reintentar ahora/);
assert.match(app,/lastSyncAt/);
assert.match(api,/async function enrichMission\(m:any, sb:any, includeEta=true\)/);
assert.match(api,/overview_fast/);
assert.match(api,/limit\(200\)/);
assert.match(api,/fastMissions/);
assert.match(api,/slice\(0,20\)/);
console.log('MEDITATION SYNC PERFORMANCE CONTRACT: PASS');

assert.match(app,/MeditationLiveExecution/);
assert.match(app,/EJECUCIÓN EN TIEMPO REAL/);
assert.match(app,/AHORA MISMO/);
assert.match(app,/ÚLTIMA ACTIVIDAD REAL/);
assert.match(app,/api\('\/missions\/' \+ encodeURIComponent\(activeId\) \+ '\/events\?live='/);
assert.match(app,/MEDITATION_LIVE_POLL_MS = 2500/);\nassert.match(app,/useLiveSync\(load, session\.accessToken, MEDITATION_LIVE_POLL_MS\)/);
console.log('MEDITATION LIVE EXECUTION CENTER CONTRACT: PASS');

assert.match(app,/executionNarrative/);
assert.match(app,/QUÉ ESTÁ PASANDO/);
assert.match(app,/EVIDENCIA/);
assert.match(app,/DESPUÉS/);
assert.match(app,/function executionResource/);
assert.match(app,/function executionNarrative/);
console.log('MEDITATION LIVE EXECUTION NARRATIVE CONTRACT: PASS');
