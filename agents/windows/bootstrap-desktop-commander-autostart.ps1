$ErrorActionPreference = 'Stop'

$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$Stage = Join-Path $RuntimeRoot 'Bootstrap'
$Base = 'https://raw.githubusercontent.com/Robvg9/aria-worker/ops/desktop-commander-autostart-v1/agents/windows'

New-Item -ItemType Directory -Force -Path $Stage | Out-Null

curl.exe -fL "$Base/desktop-commander-supervisor.ps1" -o "$Stage\desktop-commander-supervisor.ps1"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar desktop-commander-supervisor.ps1' }

curl.exe -fL "$Base/install-desktop-commander-supervisor.ps1" -o "$Stage\install-desktop-commander-supervisor.ps1"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo descargar install-desktop-commander-supervisor.ps1' }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$Stage\install-desktop-commander-supervisor.ps1"
if ($LASTEXITCODE -ne 0) { throw "Bootstrap fallo con exit code $LASTEXITCODE" }

Write-Host ''
Write-Host 'ARIA Desktop Commander autostart bootstrap complete.'
Write-Host 'El supervisor quedo registrado en Task Scheduler.'
Write-Host 'Desktop Commander 0.2.52 se mantiene en instalacion fija.'
Write-Host 'No vuelvas a iniciar DC manualmente salvo para diagnostico.'
