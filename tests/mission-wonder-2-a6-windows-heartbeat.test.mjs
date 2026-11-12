import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const agent = fs.readFileSync("agents/windows/aria-agent.js", "utf8");
const installer = fs.readFileSync("agents/windows/install-v2.ps1", "utf8");
const watchdog = fs.readFileSync("agents/windows/run-agent.ps1", "utf8");
const runtimeUpdater = fs.readFileSync("agents/windows/update-runtime-v3.ps1", "utf8");
const preflight = fs.readFileSync(".github/workflows/a6-windows-agent-v2-heartbeat-preflight.yml", "utf8");
const syntax = spawnSync(process.execPath, ["--check", "agents/windows/aria-agent.js"], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || "Windows agent JavaScript syntax check failed");

// The 90-second A6 freshness threshold needs a 30-second producer cadence,
// leaving room for one delayed/failed request without consuming the full budget.
assert.match(agent, /const HEARTBEAT_MS=30_000/);
assert.match(installer, /heartbeat_ms = 30000/);
assert.match(watchdog, /\$env:ARIA_HEARTBEAT_MS = '30000'/);
assert.match(agent, /gatewayHeartbeatInFlight/);
assert.match(agent, /if\(gatewayHeartbeatInFlight\)/);
assert.match(agent, /HEARTBEAT_ACK device=/);
assert.match(agent, /interval_ms=\$\{HEARTBEAT_MS\}/);
assert.ok(agent.includes('const requestDeadlineMs=Math.max(1000,Number(options.timeoutMs)||GATEWAY_TIMEOUT_MS)'));
assert.ok(agent.includes("const deadline=setTimeout(()=>req.destroy(new Error('gateway_timeout')),requestDeadlineMs)"));


// Separate process-local liveness from a confirmed remote heartbeat ACK.
// This makes the next interruption diagnosable without treating WAN loss as
// a reason to kill/restart a healthy Windows agent.
assert.match(agent, /aria-windows-agent-heartbeat-v2/);
assert.match(runtimeUpdater, /\$payload\.version -eq 'aria-windows-agent-heartbeat-v2'/);
assert.match(runtimeUpdater, /ARIA_PROCESS_HEARTBEAT_V2=PASS/);
assert.doesNotMatch(runtimeUpdater, /aria-windows-agent-heartbeat-v1/);
// A schema failure must preserve enough sanitized evidence to identify an unexpected writer.
assert.match(preflight, /A6_SCHEMA_MISMATCH observed=/);
assert.match(preflight, /schema_version =/);
assert.match(preflight, /heartbeat_file_sha256 =/);
assert.match(preflight, /A6_SCHEMA_PROCESS pid=/);
assert.match(preflight, /HEARTBEAT_SCHEMA_NOT_V2 observed=\$schemaVersion/);
assert.match(agent, /last_gateway_heartbeat_at/);
assert.match(agent, /last_gateway_heartbeat_error/);
assert.match(agent, /lastGatewayHeartbeatAt=new Date\(\)\.toISOString\(\)/);
assert.match(agent, /lastGatewayHeartbeatError=null/);

assert.match(watchdog, /\$GatewayHeartbeatStaleSeconds = 90/);
assert.match(watchdog, /GATEWAY_HEARTBEAT_STALE/);
assert.match(watchdog, /GATEWAY_HEARTBEAT_RECOVERED/);
assert.match(watchdog, /action=observe_only/);
assert.match(watchdog, /AGENT_STALE_HEARTBEAT action=restart/);

// Gateway staleness is observational only; the existing process-heartbeat
// watchdog remains the sole stale-process restart condition.
const gatewayBlock = watchdog.slice(
  watchdog.indexOf("# Distinguish local Node liveness"),
  watchdog.indexOf("if (Test-Path $DesktopTestRequestPath)")
);
assert.ok(gatewayBlock.includes("action=observe_only"));
assert.ok(!gatewayBlock.includes("Stop-Process"));
assert.ok(!gatewayBlock.includes("AGENT_KILLED_BY_WATCHDOG"));

console.log("MISSION_WONDER_2_A6_WINDOWS_HEARTBEAT=PASS");
