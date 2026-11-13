import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runHeartbeatLoop } = require("../agents/windows/heartbeat-scheduler.cjs");
const { createGatewayLookup } = require('../agents/windows/gateway-dns-lookup.cjs');
const { createAtomicHeartbeatWriter } = require('../agents/windows/atomic-heartbeat-writer.cjs');
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const agent = fs.readFileSync("agents/windows/aria-agent.js", "utf8");
const installer = fs.readFileSync("agents/windows/install-v2.ps1", "utf8");
const watchdog = fs.readFileSync("agents/windows/run-agent.ps1", "utf8");
const runtimeUpdater = fs.readFileSync("agents/windows/update-runtime-v3.ps1", "utf8");
const preflight = fs.readFileSync(".github/workflows/a6-windows-agent-v2-heartbeat-preflight.yml", "utf8");
const a6Installer = fs.readFileSync("agents/windows/a6-install-heartbeat-v2.ps1", "utf8");
const syntax = spawnSync(process.execPath, ["--check", "agents/windows/aria-agent.js"], { encoding: "utf8" });
assert.equal(syntax.status, 0, syntax.stderr || syntax.stdout || "Windows agent JavaScript syntax check failed");

// The A6 90-second freshness fence gets a 30-second heartbeat target.
// Every request must finish before scheduling the next one; failed ACKs retry faster.
assert.match(agent, /const HEARTBEAT_MS=30_000/);
assert.match(installer, /heartbeat_ms = 30000/);
// ROBVG must remain remote-only: the installer cannot opt into a local LLM by hardware profile.
assert.match(installer, /\$env:ARIA_ALLOW_LOCAL_LLM\s+-eq\s+'true'/);
assert.match(installer, /\$env:COMPUTERNAME\s+-ine\s+'ROBVG'/);
assert.match(installer, /ollama_enabled\s*=\s*\$localLlmEligible/);
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
assert.match(agent, /createAtomicHeartbeatWriter/);
assert.match(agent, /writeHeartbeatSnapshot\(payload\)/);
assert.match(a6Installer, /atomic-heartbeat-writer\.cjs/);
assert.match(installer, /atomic-heartbeat-writer\.cjs/);
assert.match(runtimeUpdater, /atomic-heartbeat-writer\.cjs/);

// Host installation is bounded to the exact ROBVG runtime and uses its watchdog;
// the following 45-minute qualification phase is read-only.
assert.ok(preflight.includes("name: A6 Windows Agent v2 Install + 45-minute ACK Qualification"));
assert.ok(preflight.includes("a6-install-heartbeat-v2.ps1"));
assert.ok(preflight.includes("a6-windows-heartbeat-live-readonly-diagnostic.yml"));
assert.match(preflight, /rev-parse HEAD/);
assert.match(preflight, /rev-parse \("HEAD:" \+ \$relative\)/);
assert.ok(preflight.includes("cat-file blob"), "installer must stream the exact Git blob without sparse-index path checkout");
assert.match(preflight, /RedirectStandardOutput = \$true/);
assert.match(preflight, /cat-file blob .*\+ \$blob/);
assert.match(preflight, /StandardOutput\.BaseStream\.CopyTo\(\$outputFile\)/);
assert.doesNotMatch(preflight, /ComSpec|checkout HEAD -- \$relative/);
assert.doesNotMatch(preflight, /checkout HEAD -- \$relative/);
assert.match(preflight, /hash-object --path \$relative \$installer/);
assert.match(preflight, /A6_INSTALLER_HASH_VERIFIED=true/);
assert.match(preflight, /for \(\$sampleIndex = 0; \$sampleIndex -lt 540; \$sampleIndex\+\+\)/);
assert.match(preflight, /Start-Sleep -Seconds 5/);
assert.match(preflight, /distinct_gateway_ack_count/);
assert.match(preflight, /schema_mismatch_count/);
assert.match(preflight, /OBSERVATION_SHORTER_THAN_2690S/);
assert.match(preflight, /FEWER_THAN_513_SAMPLES/);
assert.match(preflight, /GATEWAY_ACK_GAP_OVER_90S/);
assert.match(preflight, /ALL_A6_HOST_PRECHECKS_PASSED/);
assert.match(preflight, /heartbeat_scheduler_version = \[string\]\$sampleHb\.heartbeat_scheduler_version/);
assert.match(preflight, /gateway_dns_fallback_version = \[string\]\$sampleHb\.gateway_dns_fallback_version/);

assert.match(a6Installer, /COMPUTERNAME -ine 'ROBVG'/);
assert.match(a6Installer, /rev-parse HEAD/);
assert.match(a6Installer, /SOURCE_SHA_MISMATCH/);
assert.match(a6Installer, /Materialize-ExactGitBlob/);
const reuseBlockStart = a6Installer.indexOf("$runtimeExact = $true");
const reuseBlockEnd = a6Installer.indexOf("$configExact =", reuseBlockStart);
assert.ok(reuseBlockStart >= 0 && reuseBlockEnd > reuseBlockStart, "A6 exact-runtime reuse block must remain explicit");
const reuseBlock = a6Installer.slice(reuseBlockStart, reuseBlockEnd);
assert.match(reuseBlock, /\$gitRelativePath = \(\[string\]\$item\.source\)\.Replace\('\\','\/'\)/);
assert.match(reuseBlock, /rev-parse \("HEAD:" \+ \$gitRelativePath\)/);
assert.match(reuseBlock, /Materialize-ExactGitBlob -RelativePath \$gitRelativePath -DestinationPath \$sourcePath/);
assert.match(reuseBlock, /hash-object --path \$gitRelativePath \$sourcePath/);
assert.doesNotMatch(reuseBlock, /(?:rev-parse|hash-object)[^\n]*\$item\.source/);

const installLoopStart = a6Installer.indexOf("foreach ($item in $map)", a6Installer.indexOf("A6_REUSE_CHECK_REJECTED"));
const installLoopEnd = a6Installer.indexOf("\n\n  New-Item -ItemType Directory", installLoopStart);
assert.ok(installLoopStart >= 0 && installLoopEnd > installLoopStart, "A6 source materialization loop must remain explicit");
const installLoop = a6Installer.slice(installLoopStart, installLoopEnd);
assert.match(installLoop, /\$gitRelativePath = \(\[string\]\$item\.source\)\.Replace\('\\','\/'\)/);
assert.match(installLoop, /rev-parse \("HEAD:" \+ \$gitRelativePath\)/);
assert.match(installLoop, /Materialize-ExactGitBlob -RelativePath \$gitRelativePath -DestinationPath \$source/);
assert.match(installLoop, /hash-object --path \$gitRelativePath \$source/);
assert.doesNotMatch(installLoop, /(?:rev-parse|hash-object)[^\n]*\$item\.source/);
assert.ok(
  reuseBlock.indexOf("Materialize-ExactGitBlob") < reuseBlock.indexOf("Get-FileHash -LiteralPath $sourcePath"),
  "Sparse source blobs must be materialized before runtime comparison"
);
assert.ok(a6Installer.includes("cat-file blob"), "runtime sources must stream exact Git blobs");
assert.match(a6Installer, /RedirectStandardOutput = \$true/);
assert.match(a6Installer, /cat-file blob .*\+ \$ExpectedBlob/);
assert.match(a6Installer, /StandardOutput\.BaseStream\.CopyTo\(\$outputFile\)/);
assert.doesNotMatch(a6Installer, /ComSpec|checkout HEAD -- \$item\.source/);
assert.doesNotMatch(a6Installer, /checkout HEAD -- \$item\.source/);
assert.match(a6Installer, /ALREADY_INSTALLED/);
assert.match(a6Installer, /processAgeMs -lt 90000/);
assert.match(a6Installer, /gatewayAckAgeMs -lt 90000/);
assert.match(a6Installer, /restart_requested = \$false/);
assert.match(a6Installer, /hash-object --path \$gitRelativePath \$source/);
assert.match(a6Installer, /Backups\\a6-heartbeat-v2/);
assert.match(a6Installer, /Get-CimInstance Win32_Process/);
assert.match(a6Installer, /agent\.ParentProcessId -ne \$watchdogPid/);
assert.match(a6Installer, /status\.json/);
assert.match(a6Installer, /processStatus\.agent_pid/);
assert.match(a6Installer, /processStatus\.watchdog_pid/);
assert.match(a6Installer, /processStatus\.agent_path/);
assert.match(a6Installer, /processStatus\.runtime_root/);
assert.match(a6Installer, /config\.node_path/);
assert.match(a6Installer, /nodePathSource/);
assert.match(a6Installer, /nodePathIsNodeExe/);
assert.match(a6Installer, /A6_NODE_RUNTIME_PATH_INVALID/);
assert.match(a6Installer, /commandLineCompatible/);
assert.match(a6Installer, /preinstallGatewayAckAgeMs -lt 90000/);
assert.match(a6Installer, /A6_PREINSTALL_HEARTBEAT_NOT_FRESH/);
assert.match(a6Installer, /A6_PROCESS_IDENTITY_CHECK=/);

const restartBlockStart = a6Installer.indexOf("  $newPid = 0");
const restartBlockEnd = a6Installer.indexOf("  $manifest.new_agent_pid = $newPid", restartBlockStart);
assert.ok(restartBlockStart >= 0 && restartBlockEnd > restartBlockStart, "A6 restart identity block must be complete");
const restartBlock = a6Installer.slice(restartBlockStart, restartBlockEnd);
assert.ok(restartBlock.includes("candidateCommandLineAvailable"));
assert.ok(restartBlock.includes("$candidateCommandLineCompatible = (-not $candidateCommandLineAvailable -or $candidateCommandLineMatches)"));
assert.ok(restartBlock.includes("[string]$candidateStatus.agent_path -ieq $expectedAgentPath"));
assert.ok(restartBlock.includes("[string]$candidateStatus.runtime_root -ieq $root"));
assert.ok(restartBlock.includes("[string]$candidateStatus.node_path -ieq $nodePath"));
assert.ok(restartBlock.includes("[int]$candidateStatus.watchdog_pid -eq $watchdogPid"));
assert.ok(restartBlock.includes("A6_RESTART_CANDIDATE="));
assert.ok(restartBlock.includes("$manifest.restart_observations = @($restartObservations.ToArray())"));
assert.ok(restartBlock.includes("$candidateCommandLineCompatible -and"));
assert.ok(restartBlock.includes("$candidateStatusMatches"));
assert.doesNotMatch(restartBlock, /\$child\.CommandLine\s+-match\s+'aria-agent/);
assert.match(a6Installer, /process_identity = \$identityDiagnostic/);
assert.doesNotMatch(a6Installer, /Test-Path -LiteralPath \(\[string\]\$processStatus\.node_path\)/);
assert.match(a6Installer, /agent_command_line_matches = \$agentCommandLineMatches/);
assert.match(a6Installer, /watchdog_command_line_matches = \$watchdogCommandLineMatches/);
assert.match(a6Installer, /process_snapshot_count = \[int\]\$processes\.Count/);
assert.match(a6Installer, /kill-request/);
assert.match(a6Installer, /heartbeat-scheduler\.cjs/);
assert.match(a6Installer, /gateway-dns-lookup\.cjs/);
assert.match(a6Installer, /heartbeat_ms = 30000/);
assert.match(a6Installer, /ollama_enabled = \$false/);
assert.match(a6Installer, /RESTORED_RUNTIME_AND_CONFIG/);
assert.ok(a6Installer.includes('git -C $PSScriptRoot rev-parse --show-toplevel'));
assert.match(a6Installer, /\$gitRootExitCode = \$LASTEXITCODE/);
assert.match(a6Installer, /\$gitHeadExitCode = \$LASTEXITCODE/);
assert.match(a6Installer, /Test-Path -LiteralPath \$repoRoot -PathType Container/);
assert.doesNotMatch(a6Installer, /Join-Path \$repoRoot 'package\.json'/);
assert.match(a6Installer, /A6_SOURCE_GIT_ROOT_UNAVAILABLE/);
assert.doesNotMatch(a6Installer, /\bStop-Process\b|\bRestart-Service\b|\bRegister-ScheduledTask\b|\bUnregister-ScheduledTask\b|Set-NetAdapter|Restart-NetAdapter/i);
assert.doesNotMatch(a6Installer, /MISSION_EXECUTION_PAUSED|cron.*53|aria_m22_a6_start_run/i);
const observationStep = preflight.slice(preflight.indexOf("Capture installed Windows agent continuity evidence"));
assert.match(observationStep, /Start-Sleep -Seconds 5/);
assert.match(observationStep, /distinct_gateway_ack_count -lt 78/);
assert.match(observationStep, /max_gateway_ack_gap_ms -gt 90000/);
assert.match(observationStep, /scheduler_mismatch_count/);
assert.match(observationStep, /dns_fallback_mismatch_count/);
assert.doesNotMatch(observationStep, /\bCopy-Item\b|\bStop-Process\b|\bRestart-Service\b|\bRegister-ScheduledTask\b|kill-request/i);
assert.doesNotMatch(preflight, /Set-Content\s+-LiteralPath\s+\$configPath/i);

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

// Atomic heartbeat publication must never expose a truncated target to concurrent readers.
{
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'aria-heartbeat-atomic-'));
  const target = path.join(directory, 'agent-heartbeat.json');
  try {
    const writeSnapshot = createAtomicHeartbeatWriter(target, { retryDelayMs: 1, retryAttempts: 8 });
    await writeSnapshot(JSON.stringify({ sequence: -1, payload: 'ready' }));

    let observing = true;
    let readFailure = null;
    let readCount = 0;
    const reader = (async () => {
      while (observing) {
        try {
          const raw = await fs.promises.readFile(target, 'utf8');
          const parsed = JSON.parse(raw);
          assert.equal(typeof parsed.sequence, 'number');
          assert.equal(typeof parsed.payload, 'string');
          readCount += 1;
        } catch (error) {
          readFailure = error;
          break;
        }
        await new Promise(resolve => setImmediate(resolve));
      }
    })();

    await Promise.all(Array.from({ length: 120 }, (_, sequence) =>
      writeSnapshot(JSON.stringify({ sequence, payload: 'x'.repeat(32768) }))
    ));
    observing = false;
    await reader;

    assert.equal(readFailure, null, readFailure?.message || 'reader observed an invalid heartbeat snapshot');
    assert.ok(readCount > 0, 'concurrent reader did not observe any heartbeat snapshots');
    const final = JSON.parse(await fs.promises.readFile(target, 'utf8'));
    assert.equal(final.sequence, 119);
    assert.deepEqual(await fs.promises.readdir(directory), ['agent-heartbeat.json']);
  } finally {
    await fs.promises.rm(directory, { recursive: true, force: true });
  }
}

console.log("MISSION_WONDER_2_A6_GATEWAY_DNS_FALLBACK=PASS");

