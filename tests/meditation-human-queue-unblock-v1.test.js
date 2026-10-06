const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'pwa/src/App.tsx'),'utf8');
const api=fs.readFileSync(path.join(root,'supabase/functions/aria-app-api-v3/index.ts'),'utf8');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261004013000_mission_claim_queue_fairness_v1.sql'),'utf8');

// Live execution and foreground/queue state must remain separate.
assert.match(app,/function selectLiveMission/);
assert.match(app,/function selectForegroundMission/);
assert.match(app,/activeMissionRank\(m\.status,m\.lease_owner,m\.lease_until\)\s*>=\s*30/);
assert.match(app,/if \(value === 'running'\) return 35/);
assert.match(app,/if \(value === 'waiting'\) return 30/);
assert.match(app,/const displayMission = m \?\? nextQueuedMission/);
assert.match(api,/const rawActive=rawLive/);
assert.match(api,/foreground_mission:foreground/);
assert.match(api,/const active=live;/);
assert.doesNotMatch(api,/const active=latestUser\?\?live;/);
assert.match(api,/activeRank=.*running.*60.*waiting.*45/s);
assert.match(api,/queued_missions:/);

// A queued mission must never be represented as a live execution solely because it is the newest user mission.
assert.doesNotMatch(app,/const userMissions=.*if\(userMissions\.length\)return userMissions\[0\]/);

// New missions remain creatable while a mission is queued/running.
assert.match(app,/href|window\.location\.hash = '#mission'/);
assert.match(app,/＋ Nueva misión/);
assert.match(app,/ARIA puede recibir nuevas misiones mientras esta cola exista/);

// Main Meditation UI must not dump raw diagnostic traces/dependencies for humans.
assert.doesNotMatch(app,/Trace: \{String\(diagnostic\.correlation/);
assert.doesNotMatch(app,/Runtime: \{String\(diagnostic\.versions/);
assert.match(app,/diagnosticHumanSummary/);
assert.match(app,/Ver evidencia técnica/);
assert.match(app,/const compact: PwaNotificationItem\[\] = \[\]/);
assert.match(app,/compactKeys/);
assert.match(app,/setUnread\(compact\.filter/);

// Runner fairness: queued work wins over stale recovery rows within the same execution lane.
const queuedOrder=migration.indexOf("when 'queued' then 0");
const runningOrder=migration.indexOf("when 'running' then 4");
assert.ok(queuedOrder>=0 && runningOrder>queuedOrder);
assert.match(migration,/case lower\(coalesce\(m\.metadata->>'execution_lane',''\)\)/);
assert.match(migration,/for update skip locked/);

const direct=fs.readFileSync(path.join(root,'supabase/functions/aria-direct-v1/index.ts'),'utf8');
const runner=fs.readFileSync(path.join(root,'supabase/functions/aria-mission-runner-v22/index.ts'),'utf8');
assert.match(direct,/async function scheduleCanonicalRunnerKick/);
assert.match(direct,/fetch\(CANONICAL_RUNTIME/);
assert.match(direct,/body: JSON\.stringify\(\{ mission_id: missionId \}\)/);
assert.match(direct,/await scheduleCanonicalRunnerKick\(missionIdOut, "user_mission_immediate_dispatch"/);

assert.match(direct,/status: \"not_required\"/);
assert.match(direct,/canonical_runner_is_execution_authority/);
assert.doesNotMatch(direct,/status:\s*\"awaiting_device\"/);
assert.doesNotMatch(direct,/no_online_android_termux_device/);
assert.match(runner,/function scheduleMissionRetryKick\(missionId: string, reason: string\)/);
assert.match(runner,/async function scheduleMissionKick\(missionId: string, reason: string, kind: \"retry\" \| \"continuation\"\)/);
assert.match(runner,/fetch\(CANONICAL,\s*\{/);
assert.doesNotMatch(runner,/rpc\(\"runner_tick_for_mission\", \{ p_mission_id: missionId \}\)/);
assert.match(runner,/async function scheduleMissionRetryKick/);
assert.match(runner,/await scheduleMissionRetryKick\(missionId, "retry_scheduled"\)/);
assert.match(runner,/async function scheduleMissionContinuationKick\(missionId: string, reason: string\)/);
assert.match(runner,/await scheduleMissionContinuationKick\(missionId, "retry_exhausted_replan"\)/);
assert.match(runner,/await scheduleMissionContinuationKick\(missionId, "next_ready_batch"\)/);
assert.match(runner,/await scheduleMissionContinuationKick\(missionId, "verification_replan"\)/);
const retryOrderStart=runner.indexOf('const retryableFailure = failures.find');
const retryOrderEnd=runner.indexOf('// Terminal failed: primary+fallback exhausted');
assert.ok(retryOrderStart>=0 && retryOrderEnd>retryOrderStart,'retry continuation block must exist');
const retryOrder=runner.slice(retryOrderStart,retryOrderEnd);
assert.ok(retryOrder.indexOf('await emitEvent(missionId, "step_retrying"') < retryOrder.indexOf('await updateMission(missionId, {\n            lease_owner: null'),'retry event must persist before lease release');
assert.ok(retryOrder.indexOf('await updateMission(missionId, {\n            lease_owner: null') < retryOrder.indexOf('await scheduleMissionRetryKick(missionId, "retry_scheduled")'),'retry lease must release before canonical kick');


const orphan=fs.readFileSync(path.join(root,'supabase/migrations/20261004014000_orphaned_retry_reconciliation_v1.sql'),'utf8');
assert.match(orphan,/aria_reconcile_orphaned_retry_missions/);
assert.match(orphan,/status='running'/);
assert.match(orphan,/lease_owner is null/);
assert.match(orphan,/retry_scheduled/);
assert.match(orphan,/status='failed'/);
console.log('MEDITATION ORPHAN RETRY RECONCILIATION CONTRACT: PASS');

console.log('MEDITATION HUMAN + QUEUE UNBLOCK CONTRACT: PASS');
