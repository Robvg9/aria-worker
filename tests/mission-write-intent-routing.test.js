'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const planner=fs.readFileSync(path.join(root,'supabase/functions/aria-planner-v11/index.ts'),'utf8');

// Regression guard: “revisable” describes the deliverable; it must not
// turn a mutating artifact mission into a read-only review plan.
assert.match(
  planner,
  /const projectReviewIntent=.*&& !\/\\brevisable\\b\/i\.test\(g\);/
);

// The governed write route must still delegate implementation to the coder.
assert.match(planner,/target:\{type:"agent",agent_id:"aria-agent-coding-v1"\}/);
assert.match(planner,/const mutationIntent=.*crear/);

// Exact wording class that previously misrouted ARIA Mission Lab.
const missionText='Crea un pequeño artefacto web funcional llamado “ARIA Mission Lab”. Quiero que el artefacto quede realmente creado y persistido dentro del repositorio de ARIA, en una rama gobernada que no sea main, y que sea funcional y revisable, no solamente una respuesta de texto.';
assert.match(missionText,/\brevisable\b/i);
assert.match(missionText,/\bcrea\b/i);


// Recovery guard: an artifact write mission must have a material alternative after
// the agent/delegate route fails; connector mutation + physical read verification
// are the governed escape hatch.
assert.match(planner,/function githubArtifactProofRecoveryPlan\(goal:string, context:any\)/);
assert.ok(planner.includes('recovery_route:"agent_to_github_connector"'));
assert.ok(planner.includes('artifact_path:"public/aria-mission-proof.html"'));
assert.ok(planner.includes('operation:"create_branch"'));
assert.ok(planner.includes('operation:"file_write"'));
assert.ok(planner.includes('operation:"file_read"'));
assert.ok(planner.includes('non_main_branch_required:true'));


console.log('MISSION WRITE INTENT ROUTING REGRESSION: PASS');
