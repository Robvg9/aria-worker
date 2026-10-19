$ErrorActionPreference = 'Stop'
$Root = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $Root 'Runtime\windows'
$Guardian = Join-Path $RuntimeDir 'run-agent-guardian.ps1'
$LogDir = Join-Path $Root 'Logs'
$Authority = Join-Path $LogDir 'startup-authority.json'
$TaskName = 'ARIA-Windows-Agent-Guardian'
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

New-Item -ItemType Directory -Force -Path $RuntimeDir,$LogDir | Out-Null
if (-not (Test-Path $Guardian)) { throw "Guardian missing: $Guardian" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Guardian`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

$authority = [ordered]@{
    authority = 'task_scheduler_guardian_restart'
    task_name = $TaskName
    trigger = 'AtLogOn'
    principal = $currentUser
    logon_type = 'Interactive'
    restart_count = 999
    restart_interval_seconds = 60
    execution_time_limit = 'unlimited'
    multiple_instances = 'IgnoreNew'
    monitored_target = 'ARIA-Windows-Local-Agent watchdog'
    user_run = 'legacy_retained_for_active_session'
    updated_at = (Get-Date).ToUniversalTime().ToString('o')
    reason = 'Non-admin durable OS guardian because replacing legacy task requires elevation'
}
$authority | ConvertTo-Json -Depth 10 | Set-Content -Path $Authority -Encoding UTF8
Write-Host 'GUARDIAN_INSTALL=PASS'
Write-Host "GUARDIAN_TASK=$TaskName"
Write-Host "PRINCIPAL=$currentUser"
