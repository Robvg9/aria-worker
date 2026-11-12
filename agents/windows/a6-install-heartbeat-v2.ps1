$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'package.json') -PathType Leaf)) { throw 'A6_SOURCE_REPOSITORY_ROOT_NOT_FOUND' }
$expectedDevice = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
if ($env:COMPUTERNAME -ine 'ROBVG') { throw "A6_HOST_MISMATCH=$env:COMPUTERNAME" }

$root = 'D:\ARIA-Windows-Agent'
$runtime = Join-Path $root 'Runtime\windows'
$shared = Join-Path $root 'Runtime\shared'
$logs = Join-Path $root 'Logs'
$configPath = Join-Path $root 'Data\config.json'
$heartbeatPath = Join-Path $logs 'agent-heartbeat.json'
$agentPidPath = Join-Path $logs 'agent.pid'
$watchdogPidPath = Join-Path $logs 'watchdog.pid'
$killPath = Join-Path $logs 'kill-request'
$backup = Join-Path $root ("Backups\a6-heartbeat-v2-" + $env:GITHUB_RUN_ID)
$resultPath = Join-Path $env:GITHUB_WORKSPACE 'a6-windows-v2-install.json'

$map = @(
  @{ source='agents\windows\aria-agent.js'; target=Join-Path $runtime 'aria-agent.js' },
  @{ source='agents\windows\heartbeat-scheduler.cjs'; target=Join-Path $runtime 'heartbeat-scheduler.cjs' },
  @{ source='agents\windows\gateway-dns-lookup.cjs'; target=Join-Path $runtime 'gateway-dns-lookup.cjs' },
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
  foreach ($path in @($runtime,$logs,$configPath,$agentPidPath,$watchdogPidPath)) {
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
  if (-not $agent -or $agent.Name -notmatch '^(node|node\.exe)$' -or [int]$agent.ParentProcessId -ne $watchdogPid -or [string]$agent.CommandLine -notmatch 'aria-agent\.js') { throw 'A6_AGENT_IDENTITY_OR_PARENT_MISMATCH' }
  if (-not $watchdog -or $watchdog.Name -notmatch '^(powershell|powershell\.exe|pwsh|pwsh\.exe)$' -or [string]$watchdog.CommandLine -notmatch 'run-agent\.ps1') { throw 'A6_WATCHDOG_IDENTITY_MISMATCH' }
  if (@(Get-Process -Name ollama -ErrorAction SilentlyContinue).Count -gt 0) { throw 'A6_OLLAMA_PROCESS_PRESENT' }

  foreach ($item in $map) {
    $source = Join-Path $repoRoot $item.source
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "A6_SOURCE_FILE_MISSING=$($item.source)" }
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
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline -and $newPid -eq 0) {
    if (Test-Path -LiteralPath $agentPidPath) {
      $candidate = 0
      if ([int]::TryParse((Get-Content -Raw -LiteralPath $agentPidPath).Trim(),[ref]$candidate) -and $candidate -gt 0 -and $candidate -ne $oldPid) {
        $snapshot = @(Get-CimInstance Win32_Process -ErrorAction Stop)
        $child = $snapshot | Where-Object { [int]$_.ProcessId -eq $candidate } | Select-Object -First 1
        if ($child -and [int]$child.ParentProcessId -eq $watchdogPid -and $child.Name -match '^(node|node\.exe)$' -and [string]$child.CommandLine -match 'aria-agent\.js') { $newPid = $candidate }
      }
    }
    if ($newPid -eq 0) { Start-Sleep -Seconds 2 }
  }
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
