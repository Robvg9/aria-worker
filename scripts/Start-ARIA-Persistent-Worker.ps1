[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$InstallDir,

    [string]$NodePath = 'node'
)

$ErrorActionPreference = 'Stop'
$workerScript = Join-Path (Resolve-Path -LiteralPath $InstallDir).Path 'scripts\aria-persistent-windows-worker-v1.js'
$config = (Resolve-Path -LiteralPath $ConfigPath).Path
$logDir = Join-Path $env:LOCALAPPDATA 'ARIA\logs'
$logFile = Join-Path $logDir 'persistent-worker-supervisor.log'
$allowedKeys = @(
    'ARIA_CONTROL_URL',
    'ARIA_WORKER_TOKEN',
    'ARIA_AUTONOMY_ADAPTER',
    'ARIA_WORKSPACE_ROOT',
    'ARIA_OLLAMA_URL',
    'ARIA_OLLAMA_MODEL',
    'ARIA_OLLAMA_TIMEOUT_MS',
    'ARIA_WORKER_ID',
    'ARIA_WORKER_POLL_MS',
    'ARIA_WORKER_HEARTBEAT_MS'
)

if (-not (Test-Path -LiteralPath $workerScript -PathType Leaf)) {
    throw "Worker entrypoint not found: $workerScript"
}
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    throw "Worker configuration file not found: $config"
}
if ($config.StartsWith((Resolve-Path -LiteralPath $InstallDir).Path, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep the worker configuration outside the source checkout so secrets are not committed with code.'
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
foreach ($line in Get-Content -LiteralPath $config) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
    $separator = $trimmed.IndexOf('=')
    if ($separator -lt 1) { continue }
    $key = $trimmed.Substring(0, $separator).Trim()
    if ($key -notin $allowedKeys) { continue }
    $value = $trimmed.Substring($separator + 1).Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($key, $value, 'Process')
}

$delaySeconds = 5
while ($true) {
    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content -LiteralPath $logFile -Value "[$timestamp] Starting ARIA Windows worker."
    try {
        & $NodePath $workerScript *>> $logFile
        $exitCode = $LASTEXITCODE
    }
    catch {
        Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Worker launch error: $($_.Exception.Message)"
        $exitCode = 1
    }
    Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Worker exited with code $exitCode; restarting in $delaySeconds seconds."
    Start-Sleep -Seconds $delaySeconds
    $delaySeconds = [Math]::Min(60, $delaySeconds * 2)
}
