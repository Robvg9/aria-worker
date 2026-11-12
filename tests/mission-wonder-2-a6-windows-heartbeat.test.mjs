import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runHeartbeatLoop } = require("../agents/windows/heartbeat-scheduler.cjs");
const { createGatewayLookup } = require('../agents/windows/gateway-dns-lookup.cjs');
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const agent = fs.readFileSync("agents/windows/aria-agent.js", "utf8");
const installer = fs.readFileSync("agents/windows/install-v2.ps1", "utf8");
const watchdog = fs.readFileSync("agents/windows/run-agent.ps1", "utf8");
const runtimeUpdater = fs.readFileSync("agents/windows/update-runtime-v3.ps1", "utf8");
const preflight = fs.readFileSync(".github/workflows/a6-windows-agent-v2-heartbeat-preflight.yml", "utf8");
const syntax = spawnSync(process.execPath, ["--check", "agents/windows/aria-agent.js"], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || "Windows agent JavaScript syntax check failed");

// The A6 90-second freshness fence gets a 30-second heartbeat target.
// Every request must finish before scheduling the next one; failed ACKs retry faster.
assert.match(agent, /const HEARTBEAT_MS=30_000/);
assert.match(installer, /heartbeat_ms = 30000/);
assert.match(watchdog, /\$env:ARIA_HEARTBEAT_MS = '30000'/);
assert.match(agent, /gatewayHeartbeatInFlight/);
assert.match(agent, /if\(gatewayHeartbeatInFlight\)/);
assert.match(agent, /runHeartbeatLoop\(/);
assert.doesNotMatch(agent, /setInterval\(heartbeat,HEARTBEAT_MS\)/);
assert.match(agent, /HEARTBEAT_ACK device=/);
assert.match(agent, /next_interval_ms=\$\{HEARTBEAT_MS\}/);
assert.ok(agent.includes('const requestDeadlineMs=Math.max(1000,Number(options.timeoutMs)||GATEWAY_TIMEOUT_MS)'));
assert.ok(agent.includes("const deadline=setTimeout(()=>req.destroy(new Error('gateway_timeout')),requestDeadlineMs)"));

// Local process liveness and successful remote gateway ACK stay separate.
assert.match(agent, /aria-windows-agent-heartbeat-v2/);
assert.match(agent, /heartbeat_scheduler_version:'serial-retry-v1'/);
assert.match(agent, /gateway_dns_fallback_version:'supabase-scoped-public-fallback-v1'/);
assert.match(runtimeUpdater, /\$payload\.version -eq 'aria-windows-agent-heartbeat-v2'/);
assert.match(runtimeUpdater, /ARIA_PROCESS_HEARTBEAT_V2=PASS/);
assert.doesNotMatch(runtimeUpdater, /aria-windows-agent-heartbeat-v1/);
assert.match(agent, /last_gateway_heartbeat_at/);
assert.match(agent, /last_gateway_heartbeat_error/);
assert.match(agent, /lastGatewayHeartbeatAt=new Date\(\)\.toISOString\(\)/);
assert.match(agent, /lastGatewayHeartbeatError=null/);

// The host preflight is read-only, limited to the exact ROBVG host and device,
// and observes 15 minutes without mutating runtime, processes, task state or config.
assert.match(preflight, /name: A6 Windows Agent Read-Only Diagnostic/);
assert.match(preflight, /if \(\[string\]\$env:COMPUTERNAME -ine 'ROBVG'\)/);
assert.match(preflight, /Get-CimInstance Win32_Process/);
assert.match(preflight, /for \(\$sampleIndex = 0; \$sampleIndex -lt 180; \$sampleIndex\+\+\)/);
assert.match(preflight, /Start-Sleep -Seconds 5/);
assert.match(preflight, /distinct_gateway_ack_count/);
assert.match(preflight, /schema_mismatch_count/);
assert.match(preflight, /ollama_process_count/);
assert.doesNotMatch(preflight, /\bCopy-Item\b|\bNew-Item\b|\bStop-Process\b|\bRestart-Service\b|\bRegister-ScheduledTask\b|\bUnregister-ScheduledTask\b|kill-request/i);
assert.doesNotMatch(preflight, /Set-Content\s+-LiteralPath\s+\$configPath/i);
const setContentTargets = [...preflight.matchAll(/Set-Content\s+-LiteralPath\s+(\$[A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]);
assert.deepEqual(setContentTargets, ["$resultPath", "$resultPath"]);

// Only a stale local process heartbeat triggers a local restart. A stale remote
// gateway ACK is observational and must never kill a healthy Node process.
assert.match(watchdog, /\$AgentHeartbeatStaleSeconds = 60/);
assert.match(watchdog, /\$GatewayHeartbeatStaleSeconds = 90/);
assert.match(watchdog, /GATEWAY_HEARTBEAT_STALE/);
assert.match(watchdog, /GATEWAY_HEARTBEAT_RECOVERED/);
assert.match(watchdog, /action=observe_only/);
assert.match(watchdog, /AGENT_STALE_HEARTBEAT action=restart/);
const gatewayBlock = watchdog.slice(
  watchdog.indexOf("# Distinguish local Node liveness"),
  watchdog.indexOf("if (Test-Path $DesktopTestRequestPath)")
);
assert.ok(gatewayBlock.includes("action=observe_only"));
assert.ok(!gatewayBlock.includes("Stop-Process"));
assert.ok(!gatewayBlock.includes("AGENT_KILLED_BY_WATCHDOG"));

assert.match(installer, /'heartbeat-scheduler\.cjs' = Join-Path \$AgentRoot/);
assert.match(installer, /'gateway-dns-lookup\.cjs' = Join-Path \$AgentRoot/);
assert.match(runtimeUpdater, /'heartbeat-scheduler\.cjs'; destination = Join-Path \$RuntimeDir/);
assert.match(runtimeUpdater, /'gateway-dns-lookup\.cjs'; destination = Join-Path \$RuntimeDir/);

// Deterministic scheduler contract: retry at 2s then 4s, successful ACK resets
// the cadence to 30s. sendHeartbeat is awaited, so calls are never overlapped.
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

console.log("MISSION_WONDER_2_A6_WINDOWS_HEARTBEAT=PASS");
console.log("MISSION_WONDER_2_A6_WINDOWS_HEARTBEAT_SERIAL_RETRY=PASS");


// DNS fallback is scoped to the single ARIA Supabase gateway hostname.
// It activates only after the OS resolver reports a transient DNS failure.
{
  const lookups = [];
  const fallbackEvents = [];
  const originalError = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
  const lookup = createGatewayLookup({
    systemLookup: (hostname, options, callback) => {
      lookups.push({ hostname, options });
      callback(originalError);
    },
    resolver: {
      resolve4(hostname, callback) {
        callback(null, ["104.18.38.10", "172.64.149.246"]);
      },
      resolve6(hostname, callback) {
        callback(null, ["2606:4700::6812:260a"]);
      }
    },
    onFallbackStart: event => fallbackEvents.push({ type: "start", ...event }),
    onFallbackResult: event => fallbackEvents.push({ type: "result", ...event })
  });
  const result = await new Promise((resolve, reject) => {
    lookup("icuqsstxfdbvjytkhlog.supabase.co", { family: 4 }, (error, address, family) => {
      if (error) return reject(error);
      resolve({ address, family });
    });
  });
  assert.deepEqual(result, { address: "104.18.38.10", family: 4 });
  assert.equal(lookups.length, 1);
  assert.deepEqual(fallbackEvents.map(event => event.type), ["start", "result"]);
  assert.equal(fallbackEvents[1].status, "succeeded");
}

{
  const lookup = createGatewayLookup({
    systemLookup: (hostname, options, callback) => {
      callback(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
    },
    resolver: {
      resolve4(hostname, callback) { callback(null, ["104.18.38.10"]); },
      resolve6(hostname, callback) { callback(null, []); }
    }
  });
  const result = await new Promise((resolve, reject) => {
    lookup("example.com", { family: 4 }, (error, address, family) => {
      if (error) return resolve({ code: error.code });
      reject(new Error("unexpected fallback for an unrelated hostname"));
    });
  });
  assert.deepEqual(result, { code: "ENOTFOUND" });
}

{
  let fallbackCalls = 0;
  const lookup = createGatewayLookup({
    systemLookup: (hostname, options, callback) => {
      callback(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" }));
    },
    resolver: {
      resolve4(hostname, callback) { fallbackCalls += 1; callback(null, ["104.18.38.10"]); }
    }
  });
  const result = await new Promise(resolve => {
    lookup("icuqsstxfdbvjytkhlog.supabase.co", { family: 4 }, error => resolve(error?.code));
  });
  assert.equal(result, "ECONNREFUSED");
  assert.equal(fallbackCalls, 0);
}

{
  const lookup = createGatewayLookup({
    systemLookup: (hostname, options, callback) => callback(Object.assign(new Error("temporary failure"), { code: "EAI_AGAIN" })),
    resolver: {
      resolve4(hostname, callback) { callback(null, ["104.18.38.10"]); }
    }
  });
  const results = await new Promise((resolve, reject) => {
    lookup("icuqsstxfdbvjytkhlog.supabase.co", { family: 4, all: true }, (error, addresses) => {
      if (error) return reject(error);
      resolve(addresses);
    });
  });
  assert.deepEqual(results, [{ address: "104.18.38.10", family: 4 }]);
}

console.log("MISSION_WONDER_2_A6_GATEWAY_DNS_FALLBACK=PASS");
