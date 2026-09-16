$ErrorActionPreference = 'Stop'

$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$RunAgentPath = Join-Path $RuntimeDir 'run-agent.ps1'
$StartupAuthorityPath = Join-Path $LogDir 'startup-authority.json'
$TaskName = 'ARIA-Windows-Local-Agent'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'ARIA-Windows-Local-Agent'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

foreach ($dir in @($RuntimeRoot, $RuntimeDir, $LogDir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
if (-not (Test-Path $RunAgentPath)) { throw "run-agent.ps1 missing: $RunAgentPath" }

try {
    if (Test-Path $RunKey) { Remove-ItemProperty -Path $RunKey -Name $RunValueName -ErrorAction SilentlyContinue }
} catch {}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunAgentPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal `
    -UserId $currentUser `
    -LogonType Interactive `
    -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$authority = [ordered]@{
    authority = 'task_scheduler_restart_on_failure'
    task_name = $TaskName
    trigger = 'AtLogOn'
    principal = $currentUser
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

Write-Host 'STARTUP_AUTHORITY=task_scheduler_restart_on_failure'
Write-Host "TASK_NAME=$TaskName"
Write-Host "PRINCIPAL=$currentUser"
Write-Host 'RESTART_COUNT=999'
Write-Host 'RESTART_INTERVAL_SECONDS=60'
Write-Host 'EXECUTION_TIME_LIMIT=unlimited'
Write-Host 'MULTIPLE_INSTANCES=IgnoreNew'
Write-Host 'LEGACY_RUN=disabled'
Write-Host 'INSTALL_V3=PASS'
