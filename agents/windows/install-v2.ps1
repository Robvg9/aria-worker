$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$DataDir = Join-Path $RuntimeRoot 'Data'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$ConfigPath = Join-Path $DataDir 'config.json'
$TokenPath = Join-Path $DataDir 'device-token.dpapi'
$PowershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$NodePath = (Get-Command node -ErrorAction Stop).Source
$GatewayUrl = 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway'
$DeviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
$RunAgentPath = Join-Path $RuntimeDir 'run-agent.ps1'
$KillRequestPath = Join-Path $LogDir 'kill-request.json'
$WatchdogPidPath = Join-Path $LogDir 'watchdog.pid'
$StartupAuthorityPath = Join-Path $LogDir 'startup-authority.json'
$RuntimeSourceShaPath = Join-Path $LogDir 'runtime-source-sha'
$TaskName = 'ARIA-Windows-Local-Agent'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'ARIA-Windows-Local-Agent'

foreach ($dir in @($RuntimeRoot, $RuntimeDir, $DataDir, $LogDir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$requiredSources = @{
    'aria-agent.js' = Join-Path $AgentRoot 'aria-agent.js'
    'aria-meditation-controller.js' = Join-Path $AgentRoot 'aria-meditation-controller.js'
    'self-improvement-runtime.js' = Join-Path $AgentRoot 'self-improvement-runtime.js'
    'aria-safe-storage-maintenance.ps1' = Join-Path $AgentRoot 'aria-safe-storage-maintenance.ps1'
    'run-agent.ps1' = Join-Path $AgentRoot 'run-agent.ps1'
    'windows-shell-executor.js' = Join-Path $RepoRoot 'autonomy\windows-shell-executor.js'
    'windows-desktop-adapter.js' = Join-Path $RepoRoot 'computer-use\windows-desktop-adapter.js'
    'windows-desktop-runner.ps1' = Join-Path $RepoRoot 'computer-use\windows-desktop-runner.ps1'
    'windows-ui-automation.ps1' = Join-Path $RepoRoot 'computer-use\windows-ui-automation.ps1'
}
foreach ($file in $requiredSources.Keys) {
    $source = $requiredSources[$file]
    if (-not (Test-Path $source)) { throw "Required Windows agent file missing: $source" }
    Copy-Item -Path $source -Destination (Join-Path $RuntimeDir $file) -Force
}

foreach ($dirName in @('autonomy','self-development','self-model')) {
    $sourceDir = Join-Path $RepoRoot $dirName
    $destDir = Join-Path $RuntimeRoot "Runtime\$dirName"
    if (-not (Test-Path $sourceDir)) { throw "Required self-improvement runtime directory missing: $sourceDir" }
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item -Path (Join-Path $sourceDir '*') -Destination $destDir -Recurse -Force
}

$token = $env:ARIA_DEVICE_TOKEN
if (-not [string]::IsNullOrWhiteSpace($token)) {
    if ($token.Length -lt 32) { throw 'ARIA_DEVICE_TOKEN invalido.' }
    $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = $secure | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII
}
elseif (-not (Test-Path $TokenPath) -and (Test-Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi'))) {
    Copy-Item -Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi') -Destination $TokenPath -Force
}
elseif (-not (Test-Path $TokenPath)) {
    $token = Read-Host 'Pega el token del Windows Device'
    if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32) { throw 'Token ausente o invalido. No se instalo nada.' }
    $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = $secure | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII
}
if (-not (Test-Path $TokenPath)) { throw "ARIA token store was not created: $TokenPath" }

$config = [ordered]@{
    device_id = $DeviceId
    gateway_url = $GatewayUrl
    node_path = $NodePath
    agent_version = 'aria-windows-agent-v3-supervised'
    runtime_root = $RuntimeRoot
    capabilities = @('ollama.qwen3','shell.execute','computer.use','self.improve','storage.safe_maintenance')
    desktop_version = 'aria-windows-desktop-v1.8'
    meditation_version = 'aria-meditation-ia-v1'
    startup_authority = 'task_scheduler_restart_on_failure'
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8

# One startup authority only: Windows Task Scheduler under the interactive user.
# HKCU Run was the previous weaker authority and is intentionally removed.
try {
    if (Test-Path $RunKey) {
        Remove-ItemProperty -Path $RunKey -Name $RunValueName -ErrorAction SilentlyContinue
    }
} catch {}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunAgentPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$authority = [ordered]@{
    authority = 'task_scheduler_restart_on_failure'
    task_name = $TaskName
    trigger = 'AtLogOn'
    principal = "$env:USERDOMAIN\$env:USERNAME"
    logon_type = 'Interactive'
    restart_count = 999
    restart_interval_seconds = 60
    execution_time_limit = 'unlimited'
    multiple_instances = 'IgnoreNew'
    user_run = 'disabled'
    watchdog_mutex = 'Global\\ARIA-Windows-Agent-Watchdog-v1'
    updated_at = (Get-Date).ToUniversalTime().ToString('o')
    reason = 'OS-level restart authority plus non-terminating watchdog'
}
$authority | ConvertTo-Json -Depth 10 | Set-Content -Path $StartupAuthorityPath -Encoding UTF8

$runtimeSmoke = & $NodePath -e "const x=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js'); if(typeof x.executeSelfImprovementJob!=='function') process.exit(1); console.log('SELF_IMPROVEMENT_RUNTIME_LOAD=PASS')" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Self-improvement runtime load failed: $runtimeSmoke" }
$runtimeSmoke | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host 'StartupAuthority: task_scheduler_restart_on_failure'
Write-Host "Task: $TaskName"
Write-Host "Device: $DeviceId"
Write-Host "Runtime: $RuntimeDir"
Write-Host 'TaskScheduler: AtLogOn + RestartCount=999 + RestartInterval=60s + Unlimited'
Write-Host 'Watchdog: non-terminating supervisor with child restart loop'
