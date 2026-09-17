/**
 * Structural contract tests for Forensic Continuity root-cause fixes.
 * Asserts source-level contracts (no LIVE Supabase / devices).
 * Run: deno test --allow-read supabase/functions/_tests/forensic-continuity-contracts.test.ts
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url).pathname;

Deno.test("shared: planner timeout + AbortController", async () => {
  const src = await Deno.readTextFile(`${ROOT}_shared/forensic-continuity-fixes.ts`);
  assertStringIncludes(src, "PLANNER_TIMEOUT_MS");
  assertStringIncludes(src, "AbortController");
  assertStringIncludes(src, "planner_timeout");
});

Deno.test("shared: device ops allowlist shell.execute + computer.use", async () => {
  const src = await Deno.readTextFile(`${ROOT}_shared/forensic-continuity-fixes.ts`);
  assertStringIncludes(src, "DEVICE_OPS_ALLOWLIST");
  assertStringIncludes(src, "shell.execute");
  assertStringIncludes(src, "computer.use");
  assertStringIncludes(src, "device_operation_not_allowed");
});

Deno.test("shared: Cloudflare governed read ops", async () => {
  const src = await Deno.readTextFile(`${ROOT}_shared/forensic-continuity-fixes.ts`);
  for (const op of ["account_read", "worker_read", "deployments_read", "content_read"]) {
    assertStringIncludes(src, op);
  }
  assertStringIncludes(src, "/admin/cloudflare");
});

Deno.test("runner: imports shared structural fixes", async () => {
  const src = await Deno.readTextFile(`${ROOT}aria-mission-runner-v22/index.ts`);
  assertStringIncludes(src, "forensic-continuity-fixes");
  assertStringIncludes(src, "createPlanWithTimeout");
  assertStringIncludes(src, "buildDeviceEnqueuePayload");
  assertStringIncludes(src, "cloudflareConnectorExecute");
  assertStringIncludes(src, "recovery:planner_timeout");
  assertStringIncludes(src, "lease_owner: null");
});

Deno.test("agent-runtime: tool_choice required + repair_no_tool_call", async () => {
  const src = await Deno.readTextFile(`${ROOT}aria-agent-runtime-v1/tool-loop.ts`);
  assertStringIncludes(src, 'forceTool ? "required" : "auto"');
  assertStringIncludes(src, "repair_no_tool_call");
  assertStringIncludes(src, "tool_choice_requested");
  assertStringIncludes(src, "Do not treat text as mutation");
  assertStringIncludes(src, "repair_no_mutation");
});
