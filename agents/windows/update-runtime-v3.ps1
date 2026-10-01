$ErrorActionPreference = 'Stop'

$AgentSourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentSourceRoot)
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$TaskName = 'ARIA-Windows-Local-Agent'

$files = @(
    @{ source = Join-Path $AgentSourceRoot 'aria-agent.js'; destination = Join-Path $RuntimeDir 'aria-agent.js' },
    @{ source = Join-Path $AgentSourceRoot 'aria-meditation-controller.js'; destination = Join-Path $RuntimeDir 'aria-meditation-controller.js' },
    @{ source = Join-Path $AgentSourceRoot 'autonomous-rwht-controller.js'; destination = Join-Path $RuntimeDir 'autonomous-rwht-controller.js' },
    @{ source = Join-Path $AgentSourceRoot 'run-agent.ps1'; destination = Join-Path $RuntimeDir 'run-agent.ps1' },
    @{ source = Join-Path $RepoRoot 'autonomy\windows-shell-executor.js'; destination = Join-Path $RuntimeDir 'windows-shell-executor.js' },
    @{ source = Join-Path $RepoRoot 'computer-use\windows-desktop-adapter.js'; destination = Join-Path $RuntimeDir 'windows-desktop-adapter.js' },
    @{ source = Join-Path $RepoRoot 'computer-use\windows-desktop-runner.ps1'; destination = Join-Path $RuntimeDir 'windows-desktop-runner.ps1' },
    @{ source = Join-Path $RepoRoot 'computer-use\windows-ui-automation.ps1'; destination = Join-Path $RuntimeDir 'windows-ui-automation.ps1' }
)

foreach ($item in $files) {
    if (-not (Test-Path $item.source)) { throw "Source missing: $($item.source)" }
    Copy-Item -Path $item.source -Destination $item.destination -Force
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$heartbeatPath = Join-Path $LogDir 'agent-heartbeat.json'
$before = if (Test-Path $heartbeatPath) { (Get-Item $heartbeatPath).LastWriteTimeUtc } else { [datetime]::MinValue }
Remove-Item -Path $heartbeatPath -Force -ErrorAction SilentlyContinue

Write-Host "ARIA runtime updated from: $RepoRoot"
Write-Host "Runtime: $RuntimeDir"

& schtasks.exe /End /TN $TaskName 2>$null | Out-Null
Start-Sleep -Seconds 2
& schtasks.exe /Run /TN $TaskName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not start task: $TaskName" }

$deadline = (Get-Date).AddSeconds(60)
$healthy = $false
while ((Get-Date) -lt $deadline) {
    if (Test-Path $heartbeatPath) {
        $hb = Get-Item $heartbeatPath
        if ($hb.LastWriteTimeUtc -gt $before) {
            try {
                $payload = Get-Content -Raw -Path $heartbeatPath | ConvertFrom-Json
                if ($payload.version -eq 'aria-windows-agent-heartbeat-v1') {
                    Write-Host "ARIA_PROCESS_HEARTBEAT=PASS"
                    Write-Host ("HEARTBEAT_TIMESTAMP=" + $payload.timestamp)
                    Write-Host ("HEARTBEAT_NETWORK=" + $payload.network)
                    $healthy = $true
                    break
                }
            } catch {}
        }
    }
    Start-Sleep -Seconds 2
}
if (-not $healthy) {
    throw "ARIA_PROCESS_HEARTBEAT_TIMEOUT"
}

$statusPath = Join-Path $LogDir 'status.json'
if (Test-Path $statusPath) {
    try {
        $status = Get-Content -Raw -Path $statusPath | ConvertFrom-Json
        Write-Host ("WATCHDOG_STATE=" + $status.state)
        Write-Host ("AGENT_PID=" + $status.agent_pid)
    } catch {}
}

Write-Host 'ARIA Windows runtime update complete.'
