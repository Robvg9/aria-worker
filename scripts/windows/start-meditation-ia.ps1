param(
    [string]$RuntimeRoot = 'D:\ARIA-Windows-Agent',
    [int]$Port = 45873,
    [int]$WaitSeconds = 15
)
$ErrorActionPreference = 'Stop'

$ui = Join-Path $RuntimeRoot 'Runtime\windows\aria-meditation-ui.ps1'
$agentScript = Join-Path $RuntimeRoot 'Runtime\windows\run-agent.ps1'
$statusPath = Join-Path $RuntimeRoot 'Logs\status.json'
$base = "http://127.0.0.1:$Port"

function Test-ControlServer {
    try {
        $null = Invoke-RestMethod -Method Get -Uri "$base/status" -TimeoutSec 2
        return $true
    } catch { return $false }
}

if (-not (Test-Path $ui)) { throw "ARIA Meditation UI not installed: $ui" }

if (-not (Test-ControlServer)) {
    $watchdogAlive = $false
    if (Test-Path $statusPath) {
        try {
            $s = Get-Content -Raw $statusPath | ConvertFrom-Json
            if ($s.watchdog_pid) {
                $p = Get-Process -Id ([int]$s.watchdog_pid) -ErrorAction SilentlyContinue
                $watchdogAlive = $null -ne $p
            }
        } catch {}
    }

    if (-not $watchdogAlive) {
        if (-not (Test-Path $agentScript)) { throw "ARIA Windows watchdog not installed: $agentScript" }
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$agentScript) -WindowStyle Hidden
    }

    $ready = $false
    for ($i = 0; $i -lt ($WaitSeconds * 2); $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-ControlServer) { $ready = $true; break }
    }
    if (-not $ready) {
        throw "ARIA Local Agent control server did not become available at $base"
    }
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ui -Port $Port
