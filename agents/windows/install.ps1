$ErrorActionPreference = 'Stop'

# Canonical installer. The v2 installer materializes the complete runtime on D:
# and registers the interactive Scheduled Task there. Keep this wrapper so all
# entry points use the same implementation.
$InstallV2 = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'install-v2.ps1'

if (-not (Test-Path $InstallV2)) {
    throw "ARIA canonical installer not found: $InstallV2"
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $InstallV2
exit $LASTEXITCODE
