const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const css=fs.readFileSync(path.join(root,'pwa/src/index.css'),'utf8');

assert.match(api,/const missionAction = String\(body\?\.mission_action/);
assert.match(api,/const confirmedMissionGoal = missionAction === "confirm_mission"/);
assert.match(api,/missionCandidate && !confirmedMissionGoal/);
assert.match(api,/mission_confirmation_required/);
assert.match(api,/pending_mission: \{ goal: text, conversationId \}/);
assert.match(api,/if \(confirmedMissionGoal\)/);
assert.match(api,/goal: confirmedMissionGoal/);
assert.match(api,/mission_confirmation: true/);

// The canonical mission enqueue must only occur after the explicit confirmation gate.
const candidateIndex = api.indexOf('const missionCandidate');
const confirmationIndex = api.indexOf('if (confirmedMissionGoal)', candidateIndex);
const directIndex = api.indexOf('internal(DIRECT', candidateIndex);
assert.ok(candidateIndex >= 0);
assert.ok(confirmationIndex > candidateIndex);
assert.ok(directIndex > confirmationIndex);
const preConfirmation = api.slice(candidateIndex, confirmationIndex);
assert.doesNotMatch(preConfirmation,/internal\(DIRECT/);
assert.match(preConfirmation,/missionCandidate && !confirmedMissionGoal/);
assert.match(preConfirmation,/routed_to_mission: false/);

assert.match(app,/mission_confirmation_required/);
assert.match(app,/mission_action: 'confirm_mission'/);
assert.match(app,/mission_goal: pending\.goal/);
assert.match(app,/No, solo conversar/);
assert.match(app,/Sí, comenzar misión/);

assert.match(css,/.pageBodyViewport>\.executionHero\{flex:0 0 auto;min-width:0;\}/);
assert.match(css,/.meditationViewport>\.executionHero\{flex:0 0 auto!important/);

console.log('CHAT MISSION GATE + MOBILE EXECUTION CONTRACT: PASS');
