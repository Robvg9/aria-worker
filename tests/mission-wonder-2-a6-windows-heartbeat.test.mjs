import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runHeartbeatLoop } = require("../agents/windows/heartbeat-scheduler.cjs");
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
assert.match(agent, /runHeartbeatLoop\(/);
assert.doesNotMatch(agent, /setInterval\(heartbeat,HEARTBEAT_MS\)/);
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
// The A6 host probe is read-only: it observes runtime state and never repairs it.
assert.match(preflight, /name: A6 Windows Agent Read-Only Diagnostic/);
assert.match(preflight, /if \(\[string\]\$env:COMPUTERNAME -ine 'ROBVG'\)/);
assert.match(preflight, /Get-CimInstance Win32_Process/);
assert.match(preflight, /Get-ScheduledTask -TaskName/);
assert.match(preflight, /for \(\$sampleIndex = 0; \$sampleIndex -lt 180; \$sampleIndex\+\+\)/);
assert.match(preflight, /Start-Sleep -Seconds 5/);
assert.match(preflight, /distinct_gateway_ack_count/);
assert.match(preflight, /command_line_sha256/);
assert.match(preflight, /processById/);
assert.doesNotMatch(preflight, /\$selectedPid\b/);
assert.match(preflight, /schtasks\.exe \/Query/);
assert.match(preflight, /scheduled_task_discovery/);
assert.doesNotMatch(preflight, /CommandLine\s*=/);
assert.match(preflight, /ollama_process_count/);
assert.doesNotMatch(preflight, /\bCopy-Item\b|\bNew-Item\b|\bStop-Process\b|\bRestart-Service\b|kill-request/i);
assert.doesNotMatch(preflight, /Set-Content\s+-LiteralPath\s+\$configPath/i);
const setContentTargets = [...preflight.matchAll(/Set-Content\s+-LiteralPath\s+(\$[A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
assert.deepEqual(setContentTargets, ["$resultPath"]);
assert.match(agent, /last_gateway_heartbeat_at/);
assert.match(agent, /last_gateway_heartbeat_error/);
assert.match(agent, /lastGatewayHeartbeatAt=new Date\(\)\.toISOString\(\)/);
assert.match(agent, /lastGatewayHeartbeatError=null/);

assert.match(watchdog, /\$AgentHeartbeatStaleSeconds = 60/);
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


// Exercise the scheduler: failed ACKs retry at 2s then 4s; a success resets
// the cadence to 30s. Calls are awaited serially, never overlapped.
{
  let stopped = false;
  let sends = 0;
  const sleeps = [];
  const retries = [];
  const result = await runHeartbeatLoop({
    sendHeartbeat: async () => {
      sends += 1;
      return sends === 3;
    },
    shouldStop: () => stopped,
    sleep: async (ms) => {
      sleeps.push(ms);
      if (sends === 3) stopped = true;
    },
    intervalMs: 30_000,
    retryBaseMs: 2_000,
    retryMaxMs: 15_000,
    onRetry: (event) => retries.push(event)
  });
  assert.equal(sends, 3);
  assert.deepEqual(sleeps, [2_000, 4_000, 30_000]);
  assert.deepEqual(retries, [
    { consecutiveFailures: 1, delayMs: 2_000 },
    { consecutiveFailures: 2, delayMs: 4_000 }
  ]);
  assert.deepEqual(result, { consecutiveFailures: 0 });
}

{
  let stopped = false;
  let active = 0;
  let maxActive = 0;
  let sends = 0;
  await runHeartbeatLoop({
    sendHeartbeat: async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      sends += 1;
      return true;
    },
    shouldStop: () => stopped,
    sleep: async () => { stopped = true; },
    intervalMs: 30_000
  });
  assert.equal(sends, 1);
  assert.equal(maxActive, 1);
}

assert.match(installer, /'heartbeat-scheduler\.cjs' = Join-Path \$AgentRoot/);
assert.match(runtimeUpdater, /'heartbeat-scheduler\.cjs'; destination = Join-Path \$RuntimeDir/);

console.log("MISSION_WONDER_2_A6_WINDOWS_HEARTBEAT_SERIAL_RETRY=PASS");
