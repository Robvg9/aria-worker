const fs=require("fs");
const path=require("path");
const source=fs.readFileSync(path.join(__dirname,"..","supabase/functions/aria-mission-runner-v22/index.ts"),"utf8");

if(!source.includes("function preserveCompletedProgress(checkpoint: any, nextSteps: any[])")) {
  throw new Error("missing preserveCompletedProgress helper");
}
if(!source.includes("const preservedRecovery = preserveCompletedProgress(mission.checkpoint, recoveredSteps);")) {
  throw new Error("automatic strategy recovery must preserve completed progress");
}
if(!source.includes("completed_steps: preservedRecovery.completed_steps")) {
  throw new Error("automatic recovery drops completed steps");
}
if(!source.includes("const preservedIdenticalRecovery = preserveCompletedProgress(mission.checkpoint, steps);")) {
  throw new Error("identical-strategy recovery must preserve completed progress");
}
if(!source.includes("const preservedBeforeReplan = preserveCompletedProgress(checkpoint, steps);")) {
  throw new Error("step-failure replan must preserve completed progress");
}
if(!source.includes("completed_steps: preservedBeforeReplan.completed_steps")) {
  throw new Error("step-failure replan resets completed steps");
}
if(!source.includes("attempts: preservedBeforeReplan.attempts")) {
  throw new Error("step-failure replan resets completed attempts");
}
if(!source.includes("results: preservedBeforeReplan.results")) {
  throw new Error("step-failure replan resets verified results");
}
console.log("mission replan completed-progress preservation contract: PASS");
