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

// The canonical mission enqueue must no longer be inside the raw
// looksLikeMissionRequest branch; it must require the explicit confirmation path.
const missionBranch=api.slice(api.indexOf('const missionCandidate'),api.indexOf('const lane = classifyConversation'));
assert.doesNotMatch(missionBranch,/internal\(DIRECT/);
assert.match(missionBranch,/missionCandidate && !confirmedMissionGoal/);
assert.match(missionBranch,/routed_to_mission: false/);

assert.match(app,/mission_confirmation_required/);
assert.match(app,/mission_action: 'confirm_mission'/);
assert.match(app,/mission_goal: pending\.goal/);
assert.match(app,/No, solo conversar/);
assert.match(app,/Sí, comenzar misión/);

assert.match(css,/.pageBodyViewport>\.executionHero\{flex:0 0 auto;min-width:0;\}/);
assert.match(css,/.meditationViewport>\.executionHero\{flex:0 0 auto!important/);

console.log('CHAT MISSION GATE + MOBILE EXECUTION CONTRACT: PASS');
