$ErrorActionPreference = 'SilentlyContinue'
$Root = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $Root 'Runtime\windows'
$LogDir = Join-Path $Root 'Logs'
$RunAgent = Join-Path $RuntimeDir 'run-agent.ps1'
$WatchdogPidV1 = Join-Path $LogDir 'watchdog-pid'
$WatchdogPidV2 = Join-Path $LogDir 'watchdog.pid'
$GuardianPid = Join-Path $LogDir 'guardian.pid'

New-Item -ItemType Directory -Force -Path $Root,$RuntimeDir,$LogDir | Out-Null
Set-Content -Path $GuardianPid -Value $PID -Encoding ASCII

while ($true) {
    $watchdog = $null
    foreach ($pidFile in @($WatchdogPidV2,$WatchdogPidV1)) {
        if (Test-Path $pidFile) {
            try {
                $watchdog = Get-Process -Id ([int](Get-Content $pidFile -Raw).Trim()) -ErrorAction SilentlyContinue
                if ($watchdog) { break }
            } catch {}
        }
    }
    if (-not $watchdog -and (Test-Path $RunAgent)) {
        Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$RunAgent -WorkingDirectory $RuntimeDir | Out-Null
    }
    Start-Sleep -Seconds 10
}
