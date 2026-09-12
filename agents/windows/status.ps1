$TaskName = 'ARIA-Windows-Local-Agent'
$ConfigPath = Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\config.json'
$TokenPath = Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi'
$PublicDir = Join-Path $env:ProgramData 'ARIA-Windows-Agent'
$LogPath = Join-Path $PublicDir 'watchdog.log'
$PidPath = Join-Path $PublicDir 'agent.pid'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$config = if (Test-Path $ConfigPath) { Get-Content -Raw $ConfigPath | ConvertFrom-Json } else { $null }
$agent = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agents\windows\aria-agent.js*' -or $_.CommandLine -like '*aria-agent.js*' } |
    Select-Object ProcessId, CommandLine

Write-Host "ARIA Windows Agent"
Write-Host "Task installed: $([bool]$task)"
if ($task) { Write-Host "Task state: $($task.State)" }
if ($info) { Write-Host "Last task run: $($info.LastRunTime)"; Write-Host "Last task result: $($info.LastTaskResult)" }
Write-Host "Config present: $(Test-Path $ConfigPath)"
Write-Host "Protected token present: $(Test-Path $TokenPath)"
Write-Host "Public log present: $(Test-Path $LogPath)"
if ($config) {
    Write-Host "Device ID: $($config.device_id)"
    Write-Host "Gateway: $($config.gateway_url)"
    Write-Host "Node: $($config.node_path)"
    Write-Host "Agent version: $($config.agent_version)"
}
Write-Host "Agent process running: $([bool]$agent)"
if ($agent) { $agent | Format-Table -AutoSize }
if (Test-Path $PidPath) {
    Write-Host "Last recorded agent PID file: $(Get-Content -Raw $PidPath)"
}
if (Test-Path $LogPath) {
    Write-Host "--- last 15 watchdog log lines ---"
    Get-Content -Path $LogPath -Tail 15 -ErrorAction SilentlyContinue
}
