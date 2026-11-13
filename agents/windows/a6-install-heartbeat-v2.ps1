$ErrorActionPreference = 'Stop'
$gitRoot = (& git -C $PSScriptRoot rev-parse --show-toplevel 2>$null)
$gitRootExitCode = $LASTEXITCODE
$gitHead = (& git -C $PSScriptRoot rev-parse HEAD 2>$null)
$gitHeadExitCode = $LASTEXITCODE
if ($gitRootExitCode -ne 0 -or [string]::IsNullOrWhiteSpace([string]$gitRoot)) { throw "A6_SOURCE_GIT_ROOT_UNAVAILABLE script_root=$PSScriptRoot" }
if ($gitHeadExitCode -ne 0 -or [string]::IsNullOrWhiteSpace([string]$gitHead)) { throw "A6_SOURCE_GIT_HEAD_UNAVAILABLE script_root=$PSScriptRoot" }
$repoRoot = (Resolve-Path -LiteralPath ([string]$gitRoot).Trim()).Path
if (-not (Test-Path -LiteralPath $repoRoot -PathType Container)) { throw "A6_SOURCE_REPOSITORY_ROOT_NOT_FOUND root=$repoRoot script_root=$PSScriptRoot" }
if ([string]$gitHead -ne [string]$env:GITHUB_SHA) { throw "A6_SOURCE_SHA_MISMATCH expected=$env:GITHUB_SHA actual=$gitHead" }
function Materialize-ExactGitBlob {
  param([string]$RelativePath,[string]$DestinationPath,[string]$ExpectedBlob)
  $parent = Split-Path -Parent $DestinationPath
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  $gitExe = (Get-Command git.exe -ErrorAction Stop).Source
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $gitExe
  $startInfo.Arguments = '-C "' + $repoRoot + '" cat-file blob ' + $ExpectedBlob
  $startInfo.WorkingDirectory = $repoRoot
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) { throw "A6_GIT_BLOB_PROCESS_START_FAILED=$RelativePath" }
  $outputFile = $null
  try {
    $outputFile = [System.IO.File]::Open($DestinationPath,[System.IO.FileMode]::Create,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
    $process.StandardOutput.BaseStream.CopyTo($outputFile)
    $outputFile.Flush()
  } finally {
    if ($outputFile) { $outputFile.Dispose() }
  }
  $process.WaitForExit()
  $processError = $process.StandardError.ReadToEnd()
  if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $DestinationPath -PathType Leaf)) {
    throw "A6_GIT_BLOB_MATERIALIZATION_FAILED=$RelativePath exit=$($process.ExitCode) stderr=$processError"
  }
  $process.Dispose()
  $workingBlob = (& git -C $repoRoot hash-object --path $RelativePath $DestinationPath 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]$workingBlob -ne [string]$ExpectedBlob) {
    throw "A6_GIT_BLOB_HASH_MISMATCH=$RelativePath"
  }
}
$expectedDevice = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
if ($env:COMPUTERNAME -ine 'ROBVG') { throw "A6_HOST_MISMATCH=$env:COMPUTERNAME" }

# The physical qualification observed a 5m28s host/agent heartbeat outage.
# Prevent automatic AC idle sleep for this always-on worker; keep display sleep enabled.
$powerBefore = @(& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'A6_POWER_POLICY_READ_FAILED' }
$powerBeforeText = $powerBefore -join [Environment]::NewLine
$standbyBefore = $null
$manifest.power_policy_before = $powerBeforeText
& powercfg.exe /change standby-timeout-ac 0
if ($LASTEXITCODE -ne 0) { throw 'A6_DISABLE_AC_IDLE_SLEEP_FAILED' }
& powercfg.exe /change hibernate-timeout-ac 0
if ($LASTEXITCODE -ne 0) { throw 'A6_DISABLE_AC_IDLE_HIBERNATE_FAILED' }
$powerAfter = @(& powercfg.exe /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>&1)
if ($LASTEXITCODE -ne 0) { throw 'A6_AC_IDLE_SLEEP_READBACK_FAILED' }
$manifest.power_policy_after = $powerAfter -join [Environment]::NewLine
Write-Host "A6_POWER_POLICY_AC_STANDBY_BEFORE_CAPTURED=$([bool]$manifest.power_policy_before)"
Write-Host 'A6_POWER_POLICY_AC_STANDBY_AFTER=00000000'
Write-Host 'A6_POWER_POLICY_AC_HIBERNATE_AFTER=00000000'
Write-Host 'A6_POWER_POLICY_DISPLAY_SLEEP=UNCHANGED'

$root = 'D:\ARIA-Windows-Agent'
$runtime = Join-Path $root 'Runtime\windows'
$shared = Join-Path $root 'Runtime\shared'
$logs = Join-Path $root 'Logs'
$configPath = Join-Path $root 'Data\config.json'
$heartbeatPath = Join-Path $logs 'agent-heartbeat.json'
$agentPidPath = Join-Path $logs 'agent.pid'
$watchdogPidPath = Join-Path $logs 'watchdog.pid'
$statusPath = Join-Path $logs 'status.json'
$killPath = Join-Path $logs 'kill-request'
$backup = Join-Path $root ("Backups\a6-heartbeat-v2-" + $env:GITHUB_RUN_ID)
$resultPath = Join-Path $env:GITHUB_WORKSPACE 'a6-windows-v2-install.json'

$map = @(
  @{ source='agents\windows\aria-agent.js'; target=Join-Path $runtime 'aria-agent.js' },
  @{ source='agents\windows\atomic-heartbeat-writer.cjs'; target=Join-Path $runtime 'atomic-heartbeat-writer.cjs' },
  @{ source='agents\windows\heartbeat-scheduler.cjs'; target=Join-Path $runtime 'heartbeat-scheduler.cjs' },
  @{ source='agents\windows\gateway-dns-lookup.cjs'; target=Join-Path $runtime 'gateway-dns-lookup.cjs' },
  @{ source='agents\windows\gateway-http-client.cjs'; target=Join-Path $runtime 'gateway-http-client.cjs' },
  @{ source='agents\windows\aria-meditation-controller.js'; target=Join-Path $runtime 'aria-meditation-controller.js' },
  @{ source='agents\windows\autonomous-rwht-controller.js'; target=Join-Path $runtime 'autonomous-rwht-controller.js' },
  @{ source='agents\windows\resource-profile.js'; target=Join-Path $runtime 'resource-profile.js' },
  @{ source='agents\windows\run-agent.ps1'; target=Join-Path $runtime 'run-agent.ps1' },
  @{ source='autonomy\windows-shell-executor.js'; target=Join-Path $runtime 'windows-shell-executor.js' },
  @{ source='computer-use\windows-desktop-adapter.js'; target=Join-Path $runtime 'windows-desktop-adapter.js' },
  @{ source='computer-use\windows-desktop-runner.ps1'; target=Join-Path $runtime 'windows-desktop-runner.ps1' },
  @{ source='computer-use\windows-ui-automation.ps1'; target=Join-Path $runtime 'windows-ui-automation.ps1' },
  @{ source='agents\shared\voice-command-executor.cjs'; target=Join-Path $shared 'voice-command-executor.cjs' }
)

$manifest = [ordered]@{
  status='BLOCKED'
  host=$env:COMPUTERNAME
  source_sha=$env:GITHUB_SHA
  backup_dir=$backup
  runner_identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
  old_agent_pid=$null
  new_agent_pid=$null
  watchdog_pid=$null
  restart_requested=$false
  scheduler_version=$null
  dns_fallback_version=$null
  rollback='NOT_REQUIRED'
}
$backedUp = $false
$changed = $false
$oldPid = 0
$watchdogPid = 0

try {
  foreach ($path in @($runtime,$logs,$configPath,$agentPidPath,$watchdogPidPath,$statusPath,$heartbeatPath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "A6_REQUIRED_PATH_MISSING=$path" }
  }
  if (Test-Path -LiteralPath $killPath) { throw 'A6_PENDING_KILL_REQUEST_ALREADY_EXISTS' }
  $config = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  if ([string]$config.device_id -ne $expectedDevice) { throw 'A6_CONFIG_DEVICE_ID_MISMATCH' }

  if (-not [int]::TryParse((Get-Content -Raw -LiteralPath $agentPidPath).Trim(),[ref]$oldPid) -or $oldPid -le 0) { throw 'A6_AGENT_PID_INVALID' }
  if (-not [int]::TryParse((Get-Content -Raw -LiteralPath $watchdogPidPath).Trim(),[ref]$watchdogPid) -or $watchdogPid -le 0) { throw 'A6_WATCHDOG_PID_INVALID' }
  $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  $agent = $processes | Where-Object { [int]$_.ProcessId -eq $oldPid } | Select-Object -First 1
  $watchdog = $processes | Where-Object { [int]$_.ProcessId -eq $watchdogPid } | Select-Object -First 1
  $processStatus = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
  $preflightHeartbeat = Get-Content -Raw -LiteralPath $heartbeatPath | ConvertFrom-Json
  $agentExpectedPath = Join-Path $runtime 'aria-agent.js'
  $agentStatusMatches = ([int]$processStatus.agent_pid -eq $oldPid -and [string]$processStatus.agent_path -ieq $agentExpectedPath -and [string]$processStatus.runtime_root -ieq $root -and [string]$processStatus.state -eq 'agent_running')
  $watchdogStatusMatches = ([int]$processStatus.watchdog_pid -eq $watchdogPid)
  $statusNodePath = [string]$processStatus.node_path
  $configNodePath = [string]$config.node_path
  $nodePathSource = if (-not [string]::IsNullOrWhiteSpace($statusNodePath)) { 'status.json' } else { 'config.json' }
  $nodePath = if (-not [string]::IsNullOrWhiteSpace($statusNodePath)) { $statusNodePath } else { $configNodePath }
  $nodePathExists = $false
  if (-not [string]::IsNullOrWhiteSpace($nodePath)) { $nodePathExists = Test-Path -LiteralPath $nodePath -PathType Leaf }
  $nodePathIsNodeExe = ([string]$nodePath -match '(?i)[\\/]node\.exe$')
  $agentCommandLineAvailable = -not [string]::IsNullOrWhiteSpace([string]$agent.CommandLine)
  $watchdogCommandLineAvailable = -not [string]::IsNullOrWhiteSpace([string]$watchdog.CommandLine)
  $agentCommandLineMatches = [bool]($agentCommandLineAvailable -and [string]$agent.CommandLine -match 'aria-agent\.js')
  $watchdogCommandLineMatches = [bool]($watchdogCommandLineAvailable -and [string]$watchdog.CommandLine -match 'run-agent\.ps1')
  $commandLineCompatible = ((-not $agentCommandLineAvailable -or $agentCommandLineMatches) -and (-not $watchdogCommandLineAvailable -or $watchdogCommandLineMatches))
  $preinstallProcessAgeMs = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$preflightHeartbeat.timestamp).ToUniversalTime()).TotalMilliseconds
  $preinstallGatewayAckAgeMs = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$preflightHeartbeat.last_gateway_heartbeat_at).ToUniversalTime()).TotalMilliseconds
  $preinstallHeartbeatSafe = ([string]$preflightHeartbeat.device_id -eq $expectedDevice -and [string]$preflightHeartbeat.version -eq 'aria-windows-agent-heartbeat-v2' -and $preinstallProcessAgeMs -ge 0 -and $preinstallProcessAgeMs -lt 90000 -and $preinstallGatewayAckAgeMs -ge 0 -and $preinstallGatewayAckAgeMs -lt 90000 -and $null -eq $preflightHeartbeat.last_gateway_heartbeat_error)
  $identityDiagnostic = [ordered]@{
    runner_identity = [string]$manifest.runner_identity
    process_snapshot_count = [int]$processes.Count
    expected_agent_pid = $oldPid
    agent_found = [bool]$agent
    agent_name = $(if ($agent) { [string]$agent.Name } else { $null })
    agent_parent_pid = $(if ($agent) { [int]$agent.ParentProcessId } else { $null })
    agent_status_matches = $agentStatusMatches
    watchdog_status_matches = $watchdogStatusMatches
    status_state = [string]$processStatus.state
    node_path_source = $nodePathSource
    node_path_exists = $nodePathExists
    node_path_is_node_exe = $nodePathIsNodeExe
    agent_command_line_available = $agentCommandLineAvailable
    agent_command_line_matches = $agentCommandLineMatches
    expected_watchdog_pid = $watchdogPid
    watchdog_found = [bool]$watchdog
    watchdog_name = $(if ($watchdog) { [string]$watchdog.Name } else { $null })
    watchdog_command_line_available = $watchdogCommandLineAvailable
    watchdog_command_line_matches = $watchdogCommandLineMatches
    command_line_compatible = $commandLineCompatible
    preinstall_process_heartbeat_age_ms = [long]$preinstallProcessAgeMs
    preinstall_gateway_ack_age_ms = [long]$preinstallGatewayAckAgeMs
    preinstall_heartbeat_safe = $preinstallHeartbeatSafe
  }
  $manifest.old_agent_pid = $oldPid
  $manifest.watchdog_pid = $watchdogPid
  $manifest.process_identity = $identityDiagnostic
  Write-Host ("A6_PROCESS_IDENTITY_CHECK=" + ($identityDiagnostic | ConvertTo-Json -Compress))
  if (-not $preinstallHeartbeatSafe) { throw 'A6_PREINSTALL_HEARTBEAT_NOT_FRESH' }
  if (-not $agent -or $agent.Name -notmatch '^(node|node\.exe)$' -or [int]$agent.ParentProcessId -ne $watchdogPid -or -not $agentStatusMatches) { throw 'A6_AGENT_IDENTITY_OR_PARENT_MISMATCH' }
  if (-not $nodePathExists -or -not $nodePathIsNodeExe) { throw 'A6_NODE_RUNTIME_PATH_INVALID' }
  if (-not $watchdog -or $watchdog.Name -notmatch '^(powershell|powershell\.exe|pwsh|pwsh\.exe)$' -or -not $watchdogStatusMatches) { throw 'A6_WATCHDOG_IDENTITY_MISMATCH' }
  if (-not $commandLineCompatible) { throw 'A6_PROCESS_COMMAND_LINE_CONFLICT' }
  if (@(Get-Process -Name ollama -ErrorAction SilentlyContinue).Count -gt 0) { throw 'A6_OLLAMA_PROCESS_PRESENT' }

  # Idempotent reuse: a later A6 qualification run must not restart Node again
  # when the exact source SHA and its fresh serial-heartbeat runtime are already live.
  $runtimeExact = $true
  foreach ($item in $map) {
    if (-not (Test-Path -LiteralPath $item.target -PathType Leaf)) { $runtimeExact = $false; break }

    # Sparse checkout can omit tracked source files from the worktree. Resolve
    # the exact commit blob before hashing so idempotency never calls Get-FileHash
    # on a path that has not been materialized.
    $sourcePath = Join-Path $repoRoot $item.source
    # Git tree paths are slash-separated; Windows destination paths stay native.
    $gitRelativePath = ([string]$item.source).Replace('\','/')
    $sourceBlob = (& git -C $repoRoot rev-parse ("HEAD:" + $gitRelativePath) 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$sourceBlob)) {
      throw "A6_SOURCE_NOT_TRACKED_AT_EXACT_SHA=$gitRelativePath"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      Materialize-ExactGitBlob -RelativePath $gitRelativePath -DestinationPath $sourcePath -ExpectedBlob ([string]$sourceBlob)
    }
    $workingBlob = (& git -C $repoRoot hash-object --path $gitRelativePath $sourcePath 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]$workingBlob -ne [string]$sourceBlob) {
      Materialize-ExactGitBlob -RelativePath $gitRelativePath -DestinationPath $sourcePath -ExpectedBlob ([string]$sourceBlob)
      $workingBlob = (& git -C $repoRoot hash-object --path $gitRelativePath $sourcePath 2>$null)
    }
    if ($LASTEXITCODE -ne 0 -or [string]$workingBlob -ne [string]$sourceBlob) {
      throw "A6_SOURCE_WORKTREE_HASH_MISMATCH=$($item.source)"
    }
    if ((Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $item.target -Algorithm SHA256).Hash) {
      $runtimeExact = $false
      break
    }
  }
  $configExact = (
    [int]$config.heartbeat_ms -eq 30000 -and
    $config.ollama_enabled -eq $false -and
    @($config.capabilities | Where-Object { $_ -eq 'ollama.qwen3' }).Count -eq 0
  )
  if ($runtimeExact -and $configExact -and (Test-Path -LiteralPath $heartbeatPath -PathType Leaf)) {
    try {
      $currentHeartbeat = Get-Content -Raw -LiteralPath $heartbeatPath | ConvertFrom-Json
      $processAgeMs = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$currentHeartbeat.timestamp).ToUniversalTime()).TotalMilliseconds
      $gatewayAckAgeMs = ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$currentHeartbeat.last_gateway_heartbeat_at).ToUniversalTime()).TotalMilliseconds
      $heartbeatExact = (
        [string]$currentHeartbeat.device_id -eq $expectedDevice -and
        [string]$currentHeartbeat.version -eq 'aria-windows-agent-heartbeat-v2' -and
        [string]$currentHeartbeat.heartbeat_scheduler_version -eq 'serial-retry-v1' -and
        [string]$currentHeartbeat.gateway_dns_fallback_version -eq 'supabase-scoped-public-fallback-v1' -and
        $processAgeMs -ge 0 -and $processAgeMs -lt 90000 -and
        $gatewayAckAgeMs -ge 0 -and $gatewayAckAgeMs -lt 90000 -and
        $null -eq $currentHeartbeat.last_gateway_heartbeat_error
      )
      if ($heartbeatExact) {
        $manifest.status = 'ALREADY_INSTALLED'
        $manifest.old_agent_pid = $oldPid
        $manifest.new_agent_pid = $oldPid
        $manifest.watchdog_pid = $watchdogPid
        $manifest.restart_requested = $false
        $manifest.scheduler_version = [string]$currentHeartbeat.heartbeat_scheduler_version
        $manifest.dns_fallback_version = [string]$currentHeartbeat.gateway_dns_fallback_version
        $manifest.process_heartbeat_age_ms = [long]$processAgeMs
        $manifest.gateway_ack_age_ms = [long]$gatewayAckAgeMs
        $manifest.finished_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
        $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
        Write-Host 'A6_INSTALL_STATUS=ALREADY_INSTALLED'
        Write-Host "A6_REUSED_AGENT_PID=$oldPid"
        Write-Host "A6_WATCHDOG_PID=$watchdogPid"
        Write-Host "A6_HEARTBEAT_SCHEDULER=$($manifest.scheduler_version)"
        Write-Host "A6_DNS_FALLBACK=$($manifest.dns_fallback_version)"
        Write-Host "A6_PROCESS_HEARTBEAT_AGE_MS=$([long]$processAgeMs)"
        Write-Host "A6_GATEWAY_ACK_AGE_MS=$([long]$gatewayAckAgeMs)"
        return
      }
    } catch {
      Write-Host "A6_REUSE_CHECK_REJECTED=$($_.Exception.GetType().Name)"
    }
  }

  foreach ($item in $map) {
    $source = Join-Path $repoRoot $item.source
    $gitRelativePath = ([string]$item.source).Replace('\','/')
    $blob = (& git -C $repoRoot rev-parse ("HEAD:" + $gitRelativePath) 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$blob)) { throw "A6_SOURCE_NOT_TRACKED_AT_EXACT_SHA=$gitRelativePath" }
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
      # Write the exact Git blob directly; the sparse worktree may omit this file.
      Materialize-ExactGitBlob -RelativePath $gitRelativePath -DestinationPath $source -ExpectedBlob ([string]$blob)
    }
    $workingBlob = (& git -C $repoRoot hash-object --path $gitRelativePath $source 2>$null)
    if ($LASTEXITCODE -ne 0 -or [string]$workingBlob -ne [string]$blob) { throw "A6_SOURCE_WORKTREE_HASH_MISMATCH=$gitRelativePath" }
  }

  New-Item -ItemType Directory -Force -Path $backup,(Join-Path $backup 'Runtime\windows'),(Join-Path $backup 'Runtime\shared'),(Join-Path $backup 'Data'),$shared | Out-Null
  foreach ($item in $map) {
    $relative = $item.target.Substring($root.Length).TrimStart('\')
    $saved = Join-Path $backup $relative
    if (Test-Path -LiteralPath $item.target -PathType Leaf) {
      Copy-Item -LiteralPath $item.target -Destination $saved -Force
    } else {
      Set-Content -LiteralPath (Join-Path $backup ($relative + '.was-missing')) -Value 'true' -Encoding ASCII
    }
  }
  Copy-Item -LiteralPath $configPath -Destination (Join-Path $backup 'Data\config.json') -Force
  $backedUp = $true
  $changed = $true

  foreach ($item in $map) {
    $source = Join-Path $repoRoot $item.source
    $stage = $item.target + '.a6-stage-' + $env:GITHUB_RUN_ID
    Copy-Item -LiteralPath $source -Destination $stage -Force
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash) { throw "A6_STAGING_HASH_MISMATCH=$($item.source)" }
    Move-Item -LiteralPath $stage -Destination $item.target -Force
  }

  $config.heartbeat_ms = 30000
  $config.ollama_enabled = $false
  $config.capabilities = @($config.capabilities | Where-Object { [string]$_ -ne 'ollama.qwen3' })
  $configStage = $configPath + '.a6-stage-' + $env:GITHUB_RUN_ID
  [System.IO.File]::WriteAllText($configStage,($config | ConvertTo-Json -Depth 20),[System.Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $configStage -Destination $configPath -Force
  foreach ($item in $map) {
    $source = Join-Path $repoRoot $item.source
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $item.target -Algorithm SHA256).Hash) { throw "A6_RUNTIME_HASH_MISMATCH=$($item.source)" }
  }
  $readback = Get-Content -Raw -LiteralPath $configPath | ConvertFrom-Json
  if ([int]$readback.heartbeat_ms -ne 30000 -or $readback.ollama_enabled -ne $false -or @($readback.capabilities | Where-Object { $_ -eq 'ollama.qwen3' }).Count -gt 0) { throw 'A6_CONFIG_POLICY_READBACK_FAILED' }

  $oldHeartbeatWrite = if (Test-Path -LiteralPath $heartbeatPath) { (Get-Item -LiteralPath $heartbeatPath).LastWriteTimeUtc } else { [datetime]::MinValue }
  [System.IO.File]::WriteAllText($killPath,("A6_HEARTBEAT_V2:" + $env:GITHUB_SHA),[System.Text.UTF8Encoding]::new($false))
  $manifest.restart_requested = $true

  $newPid = 0
  $restartObservations = [System.Collections.Generic.List[object]]::new()
  $expectedAgentPath = Join-Path $runtime 'aria-agent.js'
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline -and $newPid -eq 0) {
    if (Test-Path -LiteralPath $agentPidPath) {
      $candidate = 0
      if ([int]::TryParse((Get-Content -Raw -LiteralPath $agentPidPath).Trim(),[ref]$candidate) -and $candidate -gt 0 -and $candidate -ne $oldPid) {
        $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        $child = $snapshot | Where-Object { [int]$_.ProcessId -eq $candidate } | Select-Object -First 1
        $candidateStatus = $null
        try { $candidateStatus = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json } catch {}
        $candidateCommandLine = if ($child) { [string]$child.CommandLine } else { '' }
        $candidateCommandLineAvailable = -not [string]::IsNullOrWhiteSpace($candidateCommandLine)
        $candidateCommandLineMatches = [bool]($candidateCommandLineAvailable -and $candidateCommandLine -match 'aria-agent\.js')
        $candidateCommandLineCompatible = (-not $candidateCommandLineAvailable -or $candidateCommandLineMatches)
        $candidateStatusMatches = [bool](
          $candidateStatus -and
          [int]$candidateStatus.agent_pid -eq $candidate -and
          [int]$candidateStatus.watchdog_pid -eq $watchdogPid -and
          [string]$candidateStatus.agent_path -ieq $expectedAgentPath -and
          [string]$candidateStatus.runtime_root -ieq $root -and
          [string]$candidateStatus.node_path -ieq $nodePath -and
          [string]$candidateStatus.state -eq 'agent_running'
        )
        $candidateObservation = [ordered]@{
          captured_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
          pid = $candidate
          process_found = [bool]$child
          process_name = if ($child) { [string]$child.Name } else { $null }
          parent_pid = if ($child) { [int]$child.ParentProcessId } else { $null }
          parent_matches_watchdog = [bool]($child -and [int]$child.ParentProcessId -eq $watchdogPid)
          process_name_matches = [bool]($child -and $child.Name -match '^(node|node\.exe)$')
          command_line_available = $candidateCommandLineAvailable
          command_line_matches = $candidateCommandLineMatches
          command_line_compatible = $candidateCommandLineCompatible
          status_matches = $candidateStatusMatches
          status_state = if ($candidateStatus) { [string]$candidateStatus.state } else { $null }
          status_agent_pid = if ($candidateStatus) { $candidateStatus.agent_pid } else { $null }
        }
        $restartObservations.Add($candidateObservation)
        if ($restartObservations.Count -gt 20) { $restartObservations.RemoveAt(0) }
        Write-Host ("A6_RESTART_CANDIDATE=" + ($candidateObservation | ConvertTo-Json -Compress))
        if (
          $child -and
          [int]$child.ParentProcessId -eq $watchdogPid -and
          $child.Name -match '^(node|node\.exe)$' -and
          $candidateCommandLineCompatible -and
          $candidateStatusMatches
        ) { $newPid = $candidate }
      }
    }
    if ($newPid -eq 0) { Start-Sleep -Seconds 2 }
  }
  $manifest.restart_observations = @($restartObservations.ToArray())
  if ($newPid -eq 0) { throw 'A6_WATCHDOG_MEDIATED_RESTART_NOT_CONFIRMED' }
  $manifest.new_agent_pid = $newPid
  $manifest.old_agent_pid = $oldPid
  $manifest.watchdog_pid = $watchdogPid

  $heartbeatOk = $false
  $deadline = (Get-Date).AddSeconds(120)
  while ((Get-Date) -lt $deadline -and -not $heartbeatOk) {
    if (Test-Path -LiteralPath $heartbeatPath) {
      try {
        $hb = Get-Content -Raw -LiteralPath $heartbeatPath | ConvertFrom-Json
        $written = (Get-Item -LiteralPath $heartbeatPath).LastWriteTimeUtc
        $age = if ($hb.timestamp) { ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse([string]$hb.timestamp).ToUniversalTime()).TotalMilliseconds } else { [double]::PositiveInfinity }
        $heartbeatOk = ($written -gt $oldHeartbeatWrite -and [string]$hb.device_id -eq $expectedDevice -and [string]$hb.version -eq 'aria-windows-agent-heartbeat-v2' -and [string]$hb.heartbeat_scheduler_version -eq 'serial-retry-v1' -and [string]$hb.gateway_dns_fallback_version -eq 'supabase-scoped-public-fallback-v1' -and $age -ge 0 -and $age -lt 90000 -and $null -eq $hb.last_gateway_heartbeat_error)
        $manifest.scheduler_version = [string]$hb.heartbeat_scheduler_version
        $manifest.dns_fallback_version = [string]$hb.gateway_dns_fallback_version
      } catch {}
    }
    if (-not $heartbeatOk) { Start-Sleep -Seconds 2 }
  }
  if (-not $heartbeatOk) { throw 'A6_NEW_HEARTBEAT_METADATA_NOT_CONFIRMED' }

  $manifest.status = 'INSTALLED'
  $manifest.finished_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  Write-Host "A6_INSTALL_STATUS=INSTALLED"
  Write-Host "A6_OLD_AGENT_PID=$oldPid"
  Write-Host "A6_NEW_AGENT_PID=$newPid"
  Write-Host "A6_WATCHDOG_PID=$watchdogPid"
  Write-Host "A6_HEARTBEAT_SCHEDULER=$($manifest.scheduler_version)"
  Write-Host "A6_DNS_FALLBACK=$($manifest.dns_fallback_version)"
} catch {
  if ($backedUp) {
    $errors = [System.Collections.Generic.List[string]]::new()
    foreach ($item in $map) {
      try {
        $relative = $item.target.Substring($root.Length).TrimStart('\')
        $saved = Join-Path $backup $relative
        $missingMarker = Join-Path $backup ($relative + '.was-missing')
        if (Test-Path -LiteralPath $missingMarker) {
          if (Test-Path -LiteralPath $item.target) { Remove-Item -LiteralPath $item.target -Force }
        } elseif (Test-Path -LiteralPath $saved) {
          Copy-Item -LiteralPath $saved -Destination $item.target -Force
        }
      } catch { $errors.Add($item.target) }
    }
    try { Copy-Item -LiteralPath (Join-Path $backup 'Data\config.json') -Destination $configPath -Force } catch { $errors.Add('Data\config.json') }
    $currentPid = 0
    if (Test-Path -LiteralPath $agentPidPath) { [void][int]::TryParse((Get-Content -Raw -LiteralPath $agentPidPath).Trim(),[ref]$currentPid) }
    if ($currentPid -gt 0) {
      if (Test-Path -LiteralPath $killPath) { Remove-Item -LiteralPath $killPath -Force -ErrorAction SilentlyContinue }
      [System.IO.File]::WriteAllText($killPath,'A6_ROLLBACK_RESTART',[System.Text.UTF8Encoding]::new($false))
    }
    $manifest.rollback = if ($errors.Count -eq 0) { 'RESTORED_RUNTIME_AND_CONFIG' } else { 'FAILED:' + ($errors -join ',') }
  }
  $manifest.status = 'BLOCKED'
  $manifest.reason = [string]$_.Exception.Message
  $manifest.finished_at_utc = [DateTimeOffset]::UtcNow.ToString('o')
  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $resultPath -Encoding UTF8
  Write-Host "A6_INSTALL_STATUS=BLOCKED"
  Write-Host "A6_INSTALL_REASON=$($manifest.reason)"
  Write-Host "A6_ROLLBACK=$($manifest.rollback)"
  throw
}
