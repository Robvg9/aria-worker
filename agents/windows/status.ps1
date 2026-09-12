$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$DataDir = Join-Path $RuntimeRoot 'Data'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$ConfigPath = Join-Path $DataDir 'config.json'
$TokenPath = Join-Path $DataDir 'device-token.dpapi'
$LogPath = Join-Path $LogDir 'watchdog.log'
$PidPath = Join-Path $LogDir 'agent.pid'
$TaskName = 'ARIA-Windows-Local-Agent'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$config = if (Test-Path $ConfigPath) { Get-Content -Raw $ConfigPath | ConvertFrom-Json } else { $null }
$agent = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*aria-agent.js*' } |
    Select-Object ProcessId, CommandLine

Write-Host "ARIA Windows Agent"
Write-Host "Runtime root: $RuntimeRoot"
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
    Write-Host "Runtime dir: $($config.runtime_dir)"
}
Write-Host "Agent process running: $([bool]$agent)"
if ($agent) { $agent | Format-Table -AutoSize }
if (Test-Path $PidPath) { Write-Host "Last recorded agent PID file: $(Get-Content -Raw $PidPath)" }
if (Test-Path $LogPath) {
    Write-Host "--- last 20 watchdog log lines ---"
    Get-Content -Path $LogPath -Tail 20 -ErrorAction SilentlyContinue
}
