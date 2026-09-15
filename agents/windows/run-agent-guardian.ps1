$ErrorActionPreference = 'SilentlyContinue'
$Root = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $Root 'Runtime\windows'
$LogDir = Join-Path $Root 'Logs'
$RunAgent = Join-Path $RuntimeDir 'run-agent.ps1'
$WatchdogPid = Join-Path $LogDir 'watchdog.pid'
$GuardianPid = Join-Path $LogDir 'guardian.pid'

New-Item -ItemType Directory -Force -Path $Root,$RuntimeDir,$LogDir | Out-Null
Set-Content -Path $GuardianPid -Value $PID -Encoding ASCII

while ($true) {
    $watchdog = $null
    if (Test-Path $WatchdogPid) {
        try { $watchdog = Get-Process -Id ([int](Get-Content $WatchdogPid -Raw).Trim()) -ErrorAction SilentlyContinue } catch {}
    }
    if (-not $watchdog -and (Test-Path $RunAgent)) {
        Start-Process powershell.exe -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$RunAgent -WorkingDirectory $RuntimeDir | Out-Null
    }
    Start-Sleep -Seconds 10
}
