param(
    [string]$RuntimeRoot = 'D:\ARIA-Windows-Agent',
    [string]$Repository = 'https://raw.githubusercontent.com/Robvg9/aria-worker/main'
)
$ErrorActionPreference = 'Stop'

$files = @(
    @{ Remote = 'autonomy/meditation-ia-controller.js'; Local = 'autonomy\meditation-ia-controller.js' },
    @{ Remote = 'autonomy/meditation-ia-policy.js'; Local = 'autonomy\meditation-ia-policy.js' },
    @{ Remote = 'autonomy/windows-shell-executor.js'; Local = 'autonomy\windows-shell-executor.js' },
    @{ Remote = 'agents/windows/aria-meditation-controller.js'; Local = 'Runtime\windows\aria-meditation-controller.js' },
    @{ Remote = 'agents/windows/aria-meditation-ui.ps1'; Local = 'Runtime\windows\aria-meditation-ui.ps1' },
    @{ Remote = 'scripts/windows/start-meditation-ia.ps1'; Local = 'Runtime\scripts\start-meditation-ia.ps1' },
    @{ Remote = 'scripts/windows/repair-meditation-ia.ps1'; Local = 'Runtime\scripts\repair-meditation-ia.ps1' }
)

Write-Host '=== ARIA MEDITACION IA - REPARACION ==='
Write-Host "RuntimeRoot=$RuntimeRoot"
$node = Get-Command node -ErrorAction Stop
$runAgent = Join-Path $RuntimeRoot 'Runtime\windows\run-agent.ps1'

$medRoot = Join-Path $RuntimeRoot 'Runtime\meditation'
New-Item -ItemType Directory -Force -Path $medRoot | Out-Null
$backup = Join-Path $medRoot ("backup-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $backup | Out-Null

Write-Host '1. Respaldando estado de control...'
foreach($name in @('state.json','checkpoint.json','ARIA-Meditation-IA.txt')){
    $source = Join-Path $medRoot $name
    if(Test-Path $source){Copy-Item $source (Join-Path $backup $name) -Force -ErrorAction SilentlyContinue}
}

Write-Host '2. Descargando versiones canónicas desde GitHub...'
foreach($item in $files){
    $target = Join-Path $RuntimeRoot $item.Local
    $parent = Split-Path -Parent $target
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $tmp = "$target.tmp"
    Invoke-WebRequest -UseBasicParsing -Uri "$Repository/$($item.Remote)" -OutFile $tmp -TimeoutSec 30
    if(-not (Test-Path $tmp)){ throw "download_missing:$($item.Remote)" }
    Move-Item $tmp $target -Force
    Write-Host "  OK $($item.Remote)"
}

Write-Host '3. Validando JavaScript canónico...'
$jsFiles = @(
    (Join-Path $RuntimeRoot 'autonomy\meditation-ia-controller.js'),
    (Join-Path $RuntimeRoot 'Runtime\windows\aria-meditation-controller.js'),
    (Join-Path $RuntimeRoot 'autonomy\meditation-ia-policy.js'),
    (Join-Path $RuntimeRoot 'autonomy\windows-shell-executor.js')
)
foreach($file in $jsFiles){
    $probe = & $node.Source --check $file 2>&1
    if($LASTEXITCODE -ne 0){ throw "NODE_SYNTAX_FAILED $file`n$probe" }
    Write-Host "  PASS $file"
}

Write-Host '4. Deteniendo solo el proceso que escucha en 127.0.0.1:45873...'
$connections = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 45873 -State Listen -ErrorAction SilentlyContinue)
foreach($connection in $connections){
    $ownerPid = [int]$connection.OwningProcess
    if($ownerPid -gt 0 -and $ownerPid -ne $PID){
        Write-Host "  Deteniendo proceso de meditacion PID=$ownerPid para recargar codigo..."
        Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    }
}

Write-Host '5. Asegurando que el watchdog este arrancado...'
$watchdogAlive = $false
$statusPath = Join-Path $RuntimeRoot 'Logs\status.json'
if(Test-Path $statusPath){
    try {
        $s = Get-Content -Raw $statusPath | ConvertFrom-Json
        if($s.watchdog_pid){$p=Get-Process -Id ([int]$s.watchdog_pid) -ErrorAction SilentlyContinue;$watchdogAlive=$null -ne $p}
    } catch {}
}
if(-not $watchdogAlive){
    if(-not (Test-Path $runAgent)){ throw "WATCHDOG_SCRIPT_MISSING $runAgent" }
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$runAgent) -WindowStyle Hidden
    Write-Host '  WATCHDOG_STARTED=True'
}

Write-Host '6. Esperando al controlador corregido...'
$base = 'http://127.0.0.1:45873'
$health = $null
for($i=0;$i -lt 30;$i++){
    try { $health = Invoke-RestMethod -Method Get -Uri "$base/health" -TimeoutSec 2 -ErrorAction Stop; break } catch { Start-Sleep -Milliseconds 500 }
}
if($null -eq $health){ throw 'CONTROL_SERVER_HEALTH_FAILED' }

Write-Host "HEALTH_OK version=$($health.version) pid=$($health.pid) mode=$($health.mode)"
if([string]$health.version -ne 'aria-windows-meditation-controller-v3'){ throw "OLD_CONTROLLER_VERSION $($health.version)" }

Write-Host '7. Prueba real de activacion...'
$result = Invoke-RestMethod -Method Post -Uri "$base/start" -TimeoutSec 15 -ErrorAction Stop
if([string]$result.status -notin @('started','resumed')){ throw "START_TEST_FAILED status=$($result.status) error=$($result.error)" }
if([string]$result.state.mode -ne 'active'){ throw "START_TEST_MODE_FAILED mode=$($result.state.mode)" }

Write-Host "START_TEST_OK status=$($result.status) mode=$($result.state.mode) session=$($result.state.session_id)"
Write-Host 'REPAIR_MEDITATION_IA=PASS'
