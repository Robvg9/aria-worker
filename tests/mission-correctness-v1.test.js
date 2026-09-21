const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const planner = fs.readFileSync(path.join(root, "supabase/functions/aria-planner-v11/index.ts"), "utf8");
const appApi = fs.readFileSync(path.join(root, "supabase/functions/aria-app-api-v3/index.ts"), "utf8");
const runner = fs.readFileSync(path.join(root, "supabase/functions/aria-mission-runner-v22/index.ts"), "utf8");

assert.match(planner, /SPANISH_OUTPUT_CONTRACT/);
assert.match(planner, /spanish_output_required:true/);
assert.match(planner, /planner-v11-governed-change-v3-multistep/);
assert.match(planner, /"analysis_1"/);
assert.match(planner, /"implementation_1"/);
assert.match(planner, /"verification_1"/);
assert.match(planner, /depends_on:\["analysis_1"\]/);
assert.match(planner, /depends_on:\["implementation_1"\]/);
assert.match(planner, /planner-v11-safe-readonly-fallback-v3-multistep/);

assert.match(appApi, /display_title/);
assert.match(appApi, /Misión #/);
assert.match(appApi, /description:String\(m\?\.goal/);
assert.match(appApi, /order\("created_at",\{ascending:false\}\)\.limit\(5000\)/);

assert.match(runner, /String\(result\?\.status \|\| ""\) === "succeeded" \? "verification_failed"/);
assert.match(runner, /result_status: result\?\.status/);
assert.match(runner, /verification_status: result\?\.repair\?\.verification_status/);

console.log("mission-correctness-v1: PASS");
