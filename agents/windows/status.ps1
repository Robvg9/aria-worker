$TaskName = 'ARIA-Windows-Local-Agent'
$ConfigPath = Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\config.json'
$TokenPath = Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$info = if ($task) { Get-ScheduledTaskInfo -TaskName $TaskName } else { $null }
$config = if (Test-Path $ConfigPath) { Get-Content -Raw $ConfigPath | ConvertFrom-Json } else { $null }
$agent = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*agents\windows\aria-agent.js*' } |
    Select-Object ProcessId, CommandLine

Write-Host "ARIA Windows Agent"
Write-Host "Task installed: $([bool]$task)"
if ($task) { Write-Host "Task state: $($task.State)" }
if ($info) { Write-Host "Last task run: $($info.LastRunTime)"; Write-Host "Last task result: $($info.LastTaskResult)" }
Write-Host "Config present: $(Test-Path $ConfigPath)"
Write-Host "Protected token present: $(Test-Path $TokenPath)"
if ($config) {
    Write-Host "Device ID: $($config.device_id)"
    Write-Host "Gateway: $($config.gateway_url)"
    Write-Host "Node: $($config.node_path)"
    Write-Host "Agent version: $($config.agent_version)"
}
Write-Host "Agent process running: $([bool]$agent)"
if ($agent) { $agent | Format-Table -AutoSize }
