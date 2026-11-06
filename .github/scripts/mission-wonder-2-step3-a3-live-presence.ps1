$ErrorActionPreference = 'Stop'
if ($env:RUNNER_NAME -ne 'ARIA-WINDOWS' -or $env:COMPUTERNAME -ne 'ROBVG') {
  throw "WRONG_PHYSICAL_RUNNER: expected ARIA-WINDOWS on ROBVG; received runner=$env:RUNNER_NAME host=$env:COMPUTERNAME"
}
if ([string]::IsNullOrWhiteSpace($env:ARIA_CONTROL_TOKEN) -or $env:ARIA_CONTROL_TOKEN.Length -lt 32 -or
    [string]::IsNullOrWhiteSpace($env:ARIA_WORKER_TOKEN) -or $env:ARIA_WORKER_TOKEN.Length -lt 32 -or
    $env:ARIA_CONTROL_TOKEN -eq $env:ARIA_WORKER_TOKEN) {
  throw 'A3 control/worker tokens are missing, invalid or not distinct.'
}

$taskName = 'ARIA Persistent Windows Worker'
$taskBefore = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskStateBefore = if ($null -eq $taskBefore) { 'NOT_REGISTERED' } else { [string]$taskBefore.State }
if ($taskStateBefore -notin @('NOT_REGISTERED', 'Disabled')) {
  throw "PERSISTENT_TASK_NOT_DISABLED: $taskStateBefore"
}

$workerScript = Join-Path $env:GITHUB_WORKSPACE 'scripts\aria-persistent-windows-worker-v1.js'
$adapter = Join-Path $env:GITHUB_WORKSPACE 'tests\fixtures\aria-frozen-worker-probe-adapter.js'
$node = 'D:\Databank\node\node.exe'
if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
  $nodeCommand = Get-Command node -ErrorAction Stop
  $node = $nodeCommand.Source
}
foreach ($required in @($workerScript, $adapter, $node)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "A3_REQUIRED_FILE_MISSING: $required" }
}

# The worker loads these tracked dependencies relative to its scripts/ directory.
# Verify them before opening a live presence scope; restore a missing worktree file
# from the exact checked-out commit, then verify Node resolves the same paths.
$runtimeModules = @(
  'autonomy/persistent-worker-error-policy-v1.js',
  'autonomy/worker-single-instance-lock-v1.js'
)
$workspaceSha = (& git -C $env:GITHUB_WORKSPACE rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $workspaceSha -ne $env:GITHUB_SHA) {
  throw "A3_WORKSPACE_COMMIT_MISMATCH: expected=$env:GITHUB_SHA actual=$workspaceSha"
}
Write-Host "A3_WORKSPACE_SHA=$workspaceSha"

foreach ($relativePath in $runtimeModules) {
  $absolutePath = Join-Path $env:GITHUB_WORKSPACE ($relativePath.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
  $treeBlob = (& git -C $env:GITHUB_WORKSPACE rev-parse "HEAD:$relativePath").Trim()
  if ($LASTEXITCODE -ne 0 -or $treeBlob.Length -notin @(40, 64) -or $treeBlob -notmatch '^[a-f0-9]+') {
    throw "A3_RUNTIME_MODULE_NOT_IN_COMMIT_TREE: $relativePath"
  }
  $indexEntry = (& git -C $env:GITHUB_WORKSPACE ls-files --stage -- $relativePath 2>&1 | Out-String).Trim()
  Write-Host "A3_RUNTIME_MODULE_TREE_BLOB=$relativePath SHA=$treeBlob"
  Write-Host "A3_RUNTIME_MODULE_INDEX_ENTRY=$relativePath VALUE=$indexEntry"

  if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
    Write-Host "A3_RUNTIME_MODULE_RESTORE_FROM_OBJECT=$relativePath"
    # Restore exact bytes from the Git object database, bypassing index/pathspec state.
    $restoreFromGitObject = "const cp=require('node:child_process');const fs=require('node:fs');const path=require('node:path');const [workspace,relativePath]=process.argv.slice(1);const blobSha=cp.execFileSync('git',['-C',workspace,'rev-parse','HEAD:'+relativePath],{encoding:'utf8'}).trim();if(![40,64].includes(blobSha.length)||!/^[a-f0-9]+/.test(blobSha))throw new Error('invalid_git_blob_sha');const content=cp.execFileSync('git',['-C',workspace,'cat-file','blob',blobSha]);const target=path.join(workspace,...relativePath.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);const written=cp.execFileSync('git',['-C',workspace,'hash-object',target],{encoding:'utf8'}).trim();if(written!==blobSha)throw new Error('restored_blob_sha_mismatch');console.log('blob='+blobSha+' bytes='+content.length+' path='+target);"
    $restoreOutput = & $node -e $restoreFromGitObject $env:GITHUB_WORKSPACE $relativePath 2>&1
    $restoreExit = $LASTEXITCODE
    $restoreOutput | ForEach-Object { Write-Host "A3_RUNTIME_MODULE_RESTORE_DETAIL=$_"}
    if ($restoreExit -ne 0) { throw "A3_RUNTIME_MODULE_RESTORE_FAILED: $relativePath exit=$restoreExit" }
  }
  if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
    throw "A3_RUNTIME_MODULE_MISSING_AFTER_RESTORE: $relativePath"
  }
  $moduleHash = (Get-FileHash -LiteralPath $absolutePath -Algorithm SHA256).Hash
  Write-Host "A3_RUNTIME_MODULE_PRESENT=$relativePath SHA256=$moduleHash"
}

Push-Location (Split-Path -Parent $workerScript)
try {
  $resolutionOutput = & $node -e "for (const name of ['../autonomy/persistent-worker-error-policy-v1', '../autonomy/worker-single-instance-lock-v1']) console.log(name + '=' + require.resolve(name))" 2>&1
  $resolutionExit = $LASTEXITCODE
  $resolutionOutput | ForEach-Object { Write-Host "A3_NODE_MODULE_RESOLVE=$_"}
  if ($resolutionExit -ne 0) { throw "A3_NODE_MODULE_RESOLUTION_FAILED: exit=$resolutionExit" }
}
finally {
  Pop-Location
}
Write-Host 'A3_RUNTIME_DEPENDENCY_PREFLIGHT=PASS'

$existingWorkers = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
  $_.Name -match '^node(\.exe)?$' -and $_.CommandLine -like '*aria-persistent-windows-worker-v1.js*'
})
if ($existingWorkers.Count -ne 0) { throw "A3_WORKER_ALREADY_PRESENT: $($existingWorkers.Count)" }

$base = 'https://aria-autonomy-coordinator.robvg9.workers.dev'
$probeId = 'mw2-a3-' + [guid]::NewGuid().ToString('N').Substring(0, 16)
$scopeToken = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$lockPath = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-instance.lock')
$logOne = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-one.log')
$errOne = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-one.err')
$logTwo = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-two.log')
$errTwo = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-two.err')
$workerOne = $null
$workerTwo = $null
$scopeStarted = $false

function Get-A3Readback {
  return Invoke-RestMethod -Method Get -Uri ($base + '/api/mission-wonder-2/a3/presence-probes/' + $probeId) -Headers @{ Authorization = "Bearer $env:ARIA_CONTROL_TOKEN" } -TimeoutSec 15
}

function Write-A3SafeProcessDiagnostics {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$StdoutPath,
    [Parameter(Mandatory = $true)][string]$StderrPath,
    [Parameter(Mandatory = $true)][System.Diagnostics.Process]$Process
  )

  try {
    try { $Process.Refresh() } catch {}
    $exitCode = 'UNAVAILABLE'
    try {
      if ($Process.HasExited) { $exitCode = [string]$Process.ExitCode }
      else { $exitCode = 'STILL_RUNNING' }
    } catch {}
    Write-Host "A3_DIAGNOSTIC_LABEL=$Label"
    Write-Host "A3_PROCESS_ID=$($Process.Id)"
    Write-Host "A3_PROCESS_EXIT_CODE=$exitCode"

    $nodeVersion = 'UNAVAILABLE'
    try { $nodeVersion = (& $node --version 2>&1 | Out-String).Trim() } catch {}
    Write-Host "A3_NODE_VERSION=$nodeVersion"

    $secretsToRedact = @(
      $env:ARIA_CONTROL_TOKEN,
      $env:ARIA_WORKER_TOKEN,
      $scopeToken,
      $env:ARIA_MW2_A3_PRESENCE_SCOPE_TOKEN
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }

    foreach ($entry in @(
      @{ Name = 'STDOUT'; Path = $StdoutPath },
      @{ Name = 'STDERR'; Path = $StderrPath }
    )) {
      Write-Host "A3_$($entry.Name)_BEGIN"
      if (Test-Path -LiteralPath $entry.Path -PathType Leaf) {
        $raw = [System.IO.File]::ReadAllText($entry.Path, [System.Text.Encoding]::UTF8)
        foreach ($secret in $secretsToRedact) {
          $raw = $raw.Replace([string]$secret, '[REDACTED]')
        }
        $lines = @($raw -split "\r?\n")
        if ($lines.Count -gt 80) {
          $lines = $lines[($lines.Count - 80)..($lines.Count - 1)]
        }
        $diagnosticText = $lines -join [Environment]::NewLine
        if ($diagnosticText.Length -gt 12000) {
          $diagnosticText = $diagnosticText.Substring($diagnosticText.Length - 12000)
        }
        if (-not [string]::IsNullOrWhiteSpace($diagnosticText)) { Write-Host $diagnosticText }
        else { Write-Host 'A3_DIAGNOSTIC_LOG_EMPTY=true' }
      } else {
        Write-Host 'A3_DIAGNOSTIC_LOG_MISSING=true'
      }
      Write-Host "A3_$($entry.Name)_END"
    }
  } catch {
    Write-Host "A3_DIAGNOSTICS_CAPTURE_FAILED=$($_.Exception.GetType().Name)"
  }
}

try {
  $startBody = @{
    confirm = 'RUN_MISSION_WONDER_2_A3_PRESENCE_ONLY'
    probe_id = $probeId
    scope_token = $scopeToken
    ttl_ms = 180000
    heartbeat_interval_ms = 5000
  } | ConvertTo-Json -Compress
  $started = Invoke-RestMethod -Method Post -Uri ($base + '/api/mission-wonder-2/a3/presence-probes/start') -Headers @{ Authorization = "Bearer $env:ARIA_CONTROL_TOKEN" } -ContentType 'application/json' -Body $startBody -TimeoutSec 20
  if ($started.probe.presence_only -ne $true -or $started.probe.mission_execution_paused -ne $true) {
    throw 'A3_SCOPE_START_READBACK_INVALID'
  }
  $scopeStarted = $true
  Write-Host "A3_SCOPE_STARTED=$probeId TTL_MS=180000 HEARTBEAT_MS=5000"

  $env:ARIA_CONTROL_URL = $base
  $env:ARIA_AUTONOMY_ADAPTER = $adapter
  $env:ARIA_WORKSPACE_ROOT = $env:GITHUB_WORKSPACE
  $env:ARIA_WORKER_LOCK_PATH = $lockPath
  $env:ARIA_MW2_A3_PRESENCE_PROBE_ID = $probeId
  $env:ARIA_MW2_A3_PRESENCE_SCOPE_TOKEN = $scopeToken
  $env:ARIA_MW2_A3_PRESENCE_INTERVAL_MS = '5000'
  $env:ARIA_MW2_A3_PRESENCE_MAX_RUNTIME_MS = '45000'

  $workerOne = Start-Process -FilePath $node -ArgumentList ('"' + $workerScript + '"') -WorkingDirectory $env:GITHUB_WORKSPACE -PassThru -NoNewWindow -RedirectStandardOutput $logOne -RedirectStandardError $errOne
  $deadline = (Get-Date).AddSeconds(30)
  $readback = $null
  do {
    Start-Sleep -Seconds 2
    $readback = Get-A3Readback
    $workerOne.Refresh()
    if ($workerOne.HasExited) {
      Write-A3SafeProcessDiagnostics -Label 'first-worker-exited-early' -StdoutPath $logOne -StderrPath $errOne -Process $workerOne
      throw 'A3_FIRST_WORKER_EXITED_EARLY'
    }
  } while ($readback.scope.presence_count -lt 3 -and (Get-Date) -lt $deadline)
  if ($readback.scope.presence_count -lt 3) {
    Write-A3SafeProcessDiagnostics -Label 'first-worker-heartbeat-timeout' -StdoutPath $logOne -StderrPath $errOne -Process $workerOne
    throw 'A3_FIRST_WORKER_DID_NOT_SEND_THREE_HEARTBEATS'
  }

  # Windows PowerShell 5.1 can promote native stderr into a terminating
  # NativeCommandError when ErrorActionPreference is Stop. Capture both streams
  # through Start-Process so the expected duplicate-lock message is data, not an exception.
  $duplicateStdout = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-duplicate.log')
  $duplicateStderr = Join-Path $env:RUNNER_TEMP ($probeId + '-worker-duplicate.err')
  $duplicateProcess = Start-Process -FilePath $node -ArgumentList ('"' + $workerScript + '"') -WorkingDirectory $env:GITHUB_WORKSPACE -PassThru -Wait -NoNewWindow -RedirectStandardOutput $duplicateStdout -RedirectStandardError $duplicateStderr
  $duplicateExit = $duplicateProcess.ExitCode
  $duplicateOutput = @()
  if (Test-Path -LiteralPath $duplicateStdout -PathType Leaf) {
    $duplicateOutput += [System.IO.File]::ReadAllText($duplicateStdout, [System.Text.Encoding]::UTF8)
  }
  if (Test-Path -LiteralPath $duplicateStderr -PathType Leaf) {
    $duplicateOutput += [System.IO.File]::ReadAllText($duplicateStderr, [System.Text.Encoding]::UTF8)
  }
  $duplicateText = $duplicateOutput -join [Environment]::NewLine
  Remove-Item -LiteralPath $duplicateStdout, $duplicateStderr -Force -ErrorAction SilentlyContinue
  if ($duplicateExit -ne 75 -or $duplicateText -notmatch 'ARIA_WORKER_ALREADY_RUNNING') {
    throw "A3_DUPLICATE_INSTANCE_GUARD_FAILED: exit=$duplicateExit output=$duplicateText"
  }
  Write-Host 'A3_SINGLE_INSTANCE_GUARD=PASS'

  Stop-Process -Id $workerOne.Id -Force -ErrorAction Stop
  $workerOne.WaitForExit(10000) | Out-Null
  $workerOne.Refresh()
  if (-not $workerOne.HasExited) { throw 'A3_FIRST_WORKER_COULD_NOT_BE_STOPPED' }
  Write-Host 'A3_SIMULATED_UNEXPECTED_PROCESS_EXIT=PASS'

  Start-Sleep -Seconds 22
  $staleReadback = Get-A3Readback
  if ($staleReadback.scope.stale -ne $true -or $staleReadback.scope.alarm_tick_count -lt 1 -or
      [string]::IsNullOrWhiteSpace([string]$staleReadback.scope.stale_detected_at)) {
    throw 'A3_STALE_HEARTBEAT_WATCHDOG_NOT_VERIFIED'
  }
  Write-Host 'A3_STALE_HEARTBEAT_DETECTION=PASS'

  # The presence-only worker has a strict 45-second self-termination bound.
  # Use Start-Process -Wait here (as in the duplicate-lock check) so Windows
  # PowerShell 5.1 captures the completed native process exit code reliably.
  $workerTwo = Start-Process -FilePath $node -ArgumentList ('"' + $workerScript + '"') -WorkingDirectory $env:GITHUB_WORKSPACE -PassThru -Wait -NoNewWindow -RedirectStandardOutput $logTwo -RedirectStandardError $errTwo
  $workerTwo.Refresh()
  $recoveryExitCode = $workerTwo.ExitCode
  if ($null -eq $recoveryExitCode) {
    Write-A3SafeProcessDiagnostics -Label 'recovery-worker-exit-code-unavailable' -StdoutPath $logTwo -StderrPath $errTwo -Process $workerTwo
    throw 'A3_RECOVERY_WORKER_EXIT_CODE_UNAVAILABLE'
  }
  if ([int]$recoveryExitCode -ne 0) {
    Write-A3SafeProcessDiagnostics -Label 'recovery-worker-exit-nonzero' -StdoutPath $logTwo -StderrPath $errTwo -Process $workerTwo
    throw "A3_RECOVERY_WORKER_EXIT_NONZERO: $recoveryExitCode"
  }
  $secondLog = if (Test-Path $logTwo) { Get-Content -Raw $logTwo } else { '' }
  if ($secondLog -notmatch 'RECOVERED_STALE=true' -or $secondLog -notmatch 'ARIA_MW2_A3_IDLE_HEARTBEAT=') {
    throw 'A3_RECOVERY_WORKER_DID_NOT_PROVE_STALE_LOCK_RECOVERY_AND_HEARTBEAT'
  }

  $finalReadback = Get-A3Readback
  if ($finalReadback.scope.status -ne 'active' -or $finalReadback.scope.presence_count -lt 6 -or
      $finalReadback.scope.recovery_count -ne 1 -or $finalReadback.scope.worker_ids.Count -ne 2 -or
      $finalReadback.scope.stale -ne $false -or $finalReadback.scope.alarm_tick_count -lt 2 -or
      $finalReadback.scope.mission_job_storage_unchanged -ne $true) {
    throw 'A3_FINAL_PRESENCE_RECOVERY_READBACK_FAILED'
  }
  if (Test-Path -LiteralPath $lockPath) { throw 'A3_WORKER_LOCK_NOT_RELEASED_AFTER_CLEAN_STOP' }

  try {
    Invoke-RestMethod -Method Post -Uri ($base + '/api/worker/claim') -Headers @{ Authorization = "Bearer $env:ARIA_WORKER_TOKEN" } -ContentType 'application/json' -Body '{"worker_id":"a3-freeze-recheck"}' -TimeoutSec 15 | Out-Null
    throw 'A3_GLOBAL_FREEZE_CLAIM_WAS_UNEXPECTEDLY_ACCEPTED'
  } catch {
    $statusCode = 0
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    if ($statusCode -ne 423) { throw }
  }
  Write-Host "A3_PRESENCE_COUNT=$($finalReadback.scope.presence_count)"
  Write-Host "A3_RECOVERY_COUNT=$($finalReadback.scope.recovery_count)"
  Write-Host "A3_ALARM_TICKS=$($finalReadback.scope.alarm_tick_count)"
  Write-Host 'A3_GLOBAL_FREEZE_STILL_423=PASS'
  Write-Host 'A3_MISSION_AND_JOB_STORES_UNCHANGED=PASS'
}
finally {
  foreach ($process in @($workerOne, $workerTwo)) {
    if ($null -ne $process) {
      try {
        $process.Refresh()
        if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
      } catch {}
    }
  }
  if ($scopeStarted) {
    $closeBody = @{
      confirm = 'CLOSE_MISSION_WONDER_2_A3_PRESENCE_ONLY'
      probe_id = $probeId
      reason = 'mission_wonder_2_step3_a3_live_pilot_finished'
    } | ConvertTo-Json -Compress
    $closed = Invoke-RestMethod -Method Post -Uri ($base + '/api/mission-wonder-2/a3/presence-probes/close') -Headers @{ Authorization = "Bearer $env:ARIA_CONTROL_TOKEN" } -ContentType 'application/json' -Body $closeBody -TimeoutSec 20
    if ($closed.scope.status -ne 'closed' -or $closed.scope.scope_token_revoked -ne $true -or
        $closed.scope.mission_job_storage_unchanged -ne $true) {
      throw 'A3_SCOPE_CLOSE_OR_TOKEN_REVOCATION_FAILED'
    }
    Write-Host 'A3_SCOPE_CLOSED_AND_TOKEN_REVOKED=PASS'
  }
  $env:ARIA_MW2_A3_PRESENCE_SCOPE_TOKEN = $null
  $env:ARIA_WORKER_TOKEN = $null
  $env:ARIA_CONTROL_TOKEN = $null
}

$taskAfter = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$taskStateAfter = if ($null -eq $taskAfter) { 'NOT_REGISTERED' } else { [string]$taskAfter.State }
if ($taskStateAfter -ne $taskStateBefore -or $taskStateAfter -notin @('NOT_REGISTERED', 'Disabled')) {
  throw "PERSISTENT_TASK_STATE_CHANGED_OR_UNSAFE: before=$taskStateBefore after=$taskStateAfter"
}
$remainingWorkers = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object {
  $_.Name -match '^node(\.exe)?$' -and $_.CommandLine -like '*aria-persistent-windows-worker-v1.js*'
})
if ($remainingWorkers.Count -ne 0) { throw "A3_ORPHAN_WORKER_PROCESSES=$($remainingWorkers.Count)" }
Write-Host "ARIA_PERSISTENT_TASK_STATE_PRESERVED=$taskStateAfter"
Write-Host 'A3_ZERO_ORPHAN_WORKER_PROCESSES=PASS'
Write-Host 'MISSION_WONDER_2_STEP_3_A3_LIVE_PILOT=PASS'
