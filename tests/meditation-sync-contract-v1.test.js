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
assert.match(api,/const hasLiveLease=.*lease_owner.*lease_until/s);
assert.match(api,/activeRank=.*running.*60.*waiting.*45.*planning.*30.*paused.*20.*queued.*10/s);
assert.match(api,/sort\(\(a:any,b:any\)=>activeRank\(b\)-activeRank\(a\)/);
console.log('MEDITATION ACTIVE MISSION PRIORITY CONTRACT: PASS');
assert.ok(api.includes('path.endsWith("/cancel")'));
assert.match(api,/status: "cancelled"/);
console.log('MEDITATION MISSION CANCELLATION CONTRACT: PASS');

assert.match(app,/MeditationLiveExecution/);
assert.match(app,/EJECUCIÓN EN TIEMPO REAL/);
assert.match(app,/AHORA MISMO/);
assert.match(app,/ÚLTIMA ACTIVIDAD REAL/);
assert.match(app,/api\('\/missions\/' \+ encodeURIComponent\(activeId\) \+ '\/events\?live='/);
assert.match(app,/MEDITATION_LIVE_POLL_MS = 2500/);
assert.match(app,/useLiveSync\(load, session\.accessToken, MEDITATION_LIVE_POLL_MS\)/);
console.log('MEDITATION LIVE EXECUTION CENTER CONTRACT: PASS');

assert.match(app,/executionNarrative/);
assert.match(app,/QUÉ ESTÁ PASANDO/);
assert.match(app,/EVIDENCIA/);
assert.match(app,/DESPUÉS/);
assert.match(app,/function executionResource/);
assert.match(app,/function executionNarrative/);
console.log('MEDITATION LIVE EXECUTION NARRATIVE CONTRACT: PASS');

const planner=fs.readFileSync(path.join(root,'supabase/functions/aria-planner-v11/index.ts'),'utf8');

assert.match(app,/freshMission/);
assert.match(app,/active_mission: \{ \.\.\.freshMission/);
assert.doesNotMatch(app,/MISIÓN ACTUAL/);
assert.match(app,/PASO EN CURSO/);
assert.match(app,/INTENTO ACTUAL/);
assert.match(app,/Se verificará al terminar el paso/);
assert.match(app,/next_ready_batch/);
assert.match(app,/Preparar y ejecutar el siguiente paso de la misión/);
console.log('MEDITATION LIVE STATE CONSISTENCY CONTRACT: PASS');

assert.match(planner,/const live=await liveOperationalContext\(goal\)/);
assert.match(planner,/CONCLUSIÓN:/);
assert.match(planner,/QUÉ PASA:/);
assert.match(planner,/PROBLEMA:/);
assert.match(planner,/EVIDENCIA:/);
assert.match(planner,/SOLUCIÓN \/ SIGUIENTE PASO:/);
assert.match(planner,/NO CONFIRMADO/);
assert.match(planner,/actionable_output_required:true/);
console.log('MEDITATION HUMAN ACTIONABLE RESULT CONTRACT: PASS');
