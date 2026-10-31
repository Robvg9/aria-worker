[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ConfigPath,

    [Parameter(Mandatory = $true)]
    [string]$InstallDir,

    [string]$NodePath = 'node',

    [string]$TaskName = 'ARIA Persistent Windows Worker',

    [switch]$InstallScheduledTask,

    [switch]$PreflightOnly
)

$ErrorActionPreference = 'Stop'
$installRoot = (Resolve-Path -LiteralPath $InstallDir).Path
$workerScript = Join-Path $installRoot 'scripts\aria-persistent-windows-worker-v1.js'
$preflightScript = Join-Path $installRoot 'scripts\aria-persistent-windows-worker-preflight-v1.js'
$launcherScript = Join-Path $installRoot 'scripts\Start-ARIA-Persistent-Worker.ps1'
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
if (-not (Test-Path -LiteralPath $launcherScript -PathType Leaf)) {
    throw "Worker launcher not found: $launcherScript"
}
if ($PreflightOnly -and $InstallScheduledTask) {
    throw 'PreflightOnly and InstallScheduledTask cannot be used together.'
}
if ($PreflightOnly -and -not (Test-Path -LiteralPath $preflightScript -PathType Leaf)) {
    throw "Worker preflight entrypoint not found: $preflightScript"
}
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    throw "Worker configuration file not found: $config"
}
if ($config.StartsWith($installRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep the worker configuration outside the source checkout so secrets are not committed with code.'
}

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

if ($PreflightOnly) {
    & $NodePath $preflightScript
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    exit 0
}

if ($InstallScheduledTask) {
    $controlUrl = [string]$env:ARIA_CONTROL_URL
    $workerToken = [string]$env:ARIA_WORKER_TOKEN
    $adapterPath = [string]$env:ARIA_AUTONOMY_ADAPTER
    $workspaceRoot = [string]$env:ARIA_WORKSPACE_ROOT
    if ($controlUrl -notmatch '^https://') {
        throw 'ARIA_CONTROL_URL must use HTTPS before installing the persistent task.'
    }
    if ($workerToken.Length -lt 32) {
        throw 'ARIA_WORKER_TOKEN must contain at least 32 characters before installing the persistent task.'
    }
    if (-not $adapterPath -or -not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
        throw 'ARIA_AUTONOMY_ADAPTER must point to an existing approved adapter file.'
    }
    if (-not $workspaceRoot -or -not (Test-Path -LiteralPath $workspaceRoot -PathType Container)) {
        throw 'ARIA_WORKSPACE_ROOT must point to an existing approved workspace directory.'
    }
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $hostExecutable = (Get-Process -Id $PID).Path
    # Launch this PowerShell supervisor, not the JavaScript entrypoint as a PowerShell script.
    # The supervisor reloads the external config and starts Node with the configured environment.
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcherScript + '" -ConfigPath "' + $config + '" -InstallDir "' + $installRoot + '" -NodePath "' + $NodePath + '" -TaskName "' + $TaskName + '"'
    $action = New-ScheduledTaskAction -Execute $hostExecutable -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Runs the ARIA outbound-only Windows worker after user logon.' -Force | Out-Null
    Start-ScheduledTask -TaskName $TaskName
    Write-Output ('ARIA_WORKER_TASK_REGISTERED=' + $TaskName)
    Write-Output 'ARIA_WORKER_TASK_TRIGGER=AtLogOn'
    Write-Output 'ARIA_WORKER_TASK_PRIVILEGE=Limited'
    Write-Output 'ARIA_WORKER_TASK_SECRET_STORAGE=External config file; no tokens are stored in task arguments.'
    exit 0
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
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
