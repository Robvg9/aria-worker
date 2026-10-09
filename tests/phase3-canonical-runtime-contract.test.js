'use strict';
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.join(__dirname,"..");
const registry=JSON.parse(fs.readFileSync(path.join(root,"runtime/canonical-registry.json"),"utf8"));
const runtime=require(path.join(root,"runtime/canonical-runtime.js"));
const health=require(path.join(root,"health/effective-status.js"));
const directSource=fs.readFileSync(path.join(root,"supabase/functions/aria-direct-v1/index.ts"),"utf8");
const canonicalRuntimeSource=fs.readFileSync(path.join(root,"supabase/functions/aria-canonical-runtime-v1/index.ts"),"utf8");
const kickSource=directSource.slice(directSource.indexOf("async function kickCanonicalRunner"),directSource.indexOf("async function scheduleCanonicalRunnerKick"));
assert.match(kickSource,/"x-aria-trigger":\s*"mission-tick"/,"user mission dispatch must use the async canonical runtime trigger");
assert.ok(canonicalRuntimeSource.includes('trigger==="mission-tick"||trigger==="scheduler"'),"canonical runtime must accept the async mission trigger");
assert.ok(canonicalRuntimeSource.includes("EdgeRuntime?.waitUntil?.(p)"),"canonical runtime must retain the runner promise in the edge execution context");
assert.equal(registry.canonical_entrypoint,"aria-canonical-runtime-v1");
assert.deepEqual(registry.stage_order,["planner","runner","runtime_gateway","execution","device_gateway","verification"]);
assert.equal(runtime.canonicalStage("planner"),"aria-planner-v11");
assert.equal(runtime.canonicalStage("runner"),"aria-mission-runner-v22");
assert.equal(runtime.canonicalStage("runtime_gateway"),"aria-runtime-gateway-v1");
assert.equal(runtime.canonicalStage("execution"),"aria-execution-runtime-v1");
assert.equal(runtime.canonicalStage("device_gateway"),"aria-device-gateway");
assert.equal(runtime.canonicalStage("verification"),"aria-smart-verifier-v1");
assert.equal(runtime.assertCanonicalChain(),true);
assert.equal(runtime.classifyFailure({surface:"pwa",executor_type:"device",stage:"runner"}).surface,"pwa");
assert.equal(runtime.classifyFailure({surface:"device",executor_type:"device",stage:"runner"}).surface,"device");
assert.equal(runtime.effectiveExecutorStatus([{executor_type:"device",status:"healthy"}],"device").status,"healthy");
assert.equal(runtime.effectiveExecutorStatus([{executor_type:"device",status:"unknown"}],"device").status,"unknown");
assert.equal(health.deriveEffectiveStatus([{executor_type:"model",status:"healthy",evidence_ref:"e1"}],"model").status,"healthy");
assert.equal(health.deriveEffectiveStatus([{executor_type:"model",status:"unknown"}],"model").status,"unknown");
const split=health.splitSurfaceStatus([
  {surface:"pwa",executor_type:"connector",status:"unavailable"},
  {surface:"device",executor_type:"device",status:"healthy"}
]);
assert.equal(split.pwa.status,"unavailable");
assert.equal(split.device.status,"healthy");
assert.equal(registry.legacy_policy,"compatibility_only_not_deployable");
console.log("PHASE3 CANONICAL RUNTIME CONTRACT: PASS");