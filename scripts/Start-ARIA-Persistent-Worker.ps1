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
$installRoot = (Resolve-Path -LiteralPath $InstallDir).Path.TrimEnd('\')
$workerScript = Join-Path $installRoot 'scripts\aria-persistent-windows-worker-v1.js'
$preflightScript = Join-Path $installRoot 'scripts\aria-persistent-windows-worker-preflight-v1.js'
$supervisorPolicyPath = Join-Path $installRoot 'scripts\aria-worker-supervisor-policy-v1.ps1'
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
$script:WorkerConfigIsDpapi = $false

function Set-WorkerProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [AllowNull()][string]$Value
    )

    if ($Name -notin $allowedKeys) { return }
    if ($null -ne $Value) {
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
    }
}

function Import-WorkerConfiguration {
    $rawConfig = Get-Content -LiteralPath $config -Raw
    if ($rawConfig.TrimStart().StartsWith('{')) {
        $document = $rawConfig | ConvertFrom-Json -ErrorAction Stop
        if ($document.format -ne 'aria-worker-config-dpapi-v1') {
            throw 'Worker JSON config format is not recognized.'
        }

        $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        if ([string]$document.protectedForSid -ne $currentSid) {
            throw 'Worker config was protected for a different Windows user.'
        }
        if ([string]::IsNullOrWhiteSpace([string]$document.workerTokenDpapi)) {
            throw 'DPAPI worker token is missing from the protected config.'
        }

        $secureToken = ConvertTo-SecureString -String ([string]$document.workerTokenDpapi) -ErrorAction Stop
        $tokenPointer = [IntPtr]::Zero
        try {
            $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
            $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
            Set-WorkerProcessEnvironment -Name 'ARIA_WORKER_TOKEN' -Value $plainToken
        }
        finally {
            if ($tokenPointer -ne [IntPtr]::Zero) {
                [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
            }
            $plainToken = $null
            $secureToken.Dispose()
        }

        foreach ($property in $document.values.PSObject.Properties) {
            Set-WorkerProcessEnvironment -Name $property.Name -Value ([string]$property.Value)
        }
        $script:WorkerConfigIsDpapi = $true
        return
    }

    # Plain env files remain accepted only for the one-shot CI/manual preflight.
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
        Set-WorkerProcessEnvironment -Name $key -Value $value
    }
}

if (-not (Test-Path -LiteralPath $workerScript -PathType Leaf)) {
    throw "Worker entrypoint not found: $workerScript"
}
if (-not (Test-Path -LiteralPath $launcherScript -PathType Leaf)) {
    throw "Worker launcher not found: $launcherScript"
}
if (-not (Test-Path -LiteralPath $supervisorPolicyPath -PathType Leaf)) {
    throw "Worker supervisor policy not found: $supervisorPolicyPath"
}
. $supervisorPolicyPath
if ($PreflightOnly -and $InstallScheduledTask) {
    throw 'PreflightOnly and InstallScheduledTask cannot be used together.'
}
if ($PreflightOnly -and -not (Test-Path -LiteralPath $preflightScript -PathType Leaf)) {
    throw "Worker preflight entrypoint not found: $preflightScript"
}
if (-not (Test-Path -LiteralPath $config -PathType Leaf)) {
    throw "Worker configuration file not found: $config"
}
if ($config.StartsWith(($installRoot + '\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep the worker configuration outside the source checkout so secrets are not committed with code.'
}

Import-WorkerConfiguration

if ($InstallScheduledTask -or -not $PreflightOnly) {
    if (-not $script:WorkerConfigIsDpapi) {
        throw 'Persistent worker operations require a DPAPI-protected config created for the current Windows user.'
    }
}

if ($PreflightOnly) {
    & $NodePath $preflightScript
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    exit 0
}

if ($InstallScheduledTask) {
    $profileConfigRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ARIA\worker')).TrimEnd('\') + '\'
    if (-not $config.StartsWith($profileConfigRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Install the DPAPI config under %LOCALAPPDATA%\ARIA\worker before registering the scheduled task.'
    }

    $controlUrl = [string]$env:ARIA_CONTROL_URL
    $workerToken = [string]$env:ARIA_WORKER_TOKEN
    $adapterPath = [string]$env:ARIA_AUTONOMY_ADAPTER
    $workspaceRoot = [string]$env:ARIA_WORKSPACE_ROOT
    if ($controlUrl -notmatch '^https://') {
        throw 'ARIA_CONTROL_URL must use HTTPS before registering the persistent task.'
    }
    if ($workerToken.Length -lt 32) {
        throw 'ARIA_WORKER_TOKEN must contain at least 32 characters before registering the persistent task.'
    }
    if (-not $adapterPath -or -not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
        throw 'ARIA_AUTONOMY_ADAPTER must point to an existing approved adapter file.'
    }
    if (-not $workspaceRoot -or -not (Test-Path -LiteralPath $workspaceRoot -PathType Container)) {
        throw 'ARIA_WORKSPACE_ROOT must point to an existing approved workspace directory.'
    }
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        throw 'A scheduled task with this name already exists. Review it before replacing or changing it.'
    }

    $currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $currentUser = $currentIdentity.Name
    $taskHostSource = Join-Path $installRoot 'scripts\aria-worker-task-host.cs'
    $taskHostDirectory = Join-Path $env:LOCALAPPDATA 'ARIA\worker'
    $taskHostExecutable = Join-Path $taskHostDirectory 'aria-worker-task-host.exe'
    $taskHostTemporary = $taskHostExecutable + '.tmp.exe'
    $compilerCandidates = @(
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
        (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
    )
    $taskHostCompiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

    if (-not (Test-Path -LiteralPath $taskHostSource -PathType Leaf)) {
        throw "Console-less worker task host source not found: $taskHostSource"
    }
    if (-not $taskHostCompiler) {
        throw 'The .NET Framework C# compiler is required to build the Windows GUI task host.'
    }

    New-Item -ItemType Directory -Path $taskHostDirectory -Force | Out-Null
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    Remove-Item -LiteralPath $taskHostTemporary -Force -ErrorAction SilentlyContinue

    & $taskHostCompiler /nologo /target:winexe /platform:anycpu /optimize+ ("/out:" + $taskHostTemporary) $taskHostSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $taskHostTemporary -PathType Leaf)) {
        Remove-Item -LiteralPath $taskHostTemporary -Force -ErrorAction SilentlyContinue
        throw "Windows no-console task host compilation failed (exit=$LASTEXITCODE)."
    }

    $selfTestLog = Join-Path $env:TEMP ('aria-worker-task-host-selftest-' + [guid]::NewGuid().ToString('N') + '.log')
    try {
        $selfTest = Start-Process -FilePath $taskHostTemporary -ArgumentList ('--self-test "' + $selfTestLog + '"') -WorkingDirectory $installRoot -Wait -PassThru
        if ($selfTest.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $selfTestLog -PathType Leaf)) {
            $details = if (Test-Path -LiteralPath $selfTestLog) { Get-Content -LiteralPath $selfTestLog -Raw } else { 'self-test log was not created' }
            throw "Windows no-console task host self-test failed (exit=$($selfTest.ExitCode)): $details"
        }
        $selfTestContent = Get-Content -LiteralPath $selfTestLog -Raw
        foreach ($marker in @('SELFTEST_HOST_CONSOLE=NONE', 'CHILD_CONSOLE=NONE', 'SELFTEST_CHILD_EXIT_CODE=0', 'SELFTEST_RESULT=PASS')) {
            if (-not $selfTestContent.Contains($marker)) {
                throw "Windows no-console task host self-test is missing marker: $marker"
            }
        }
    }
    finally {
        Remove-Item -LiteralPath $selfTestLog -Force -ErrorAction SilentlyContinue
    }

    Move-Item -LiteralPath $taskHostTemporary -Destination $taskHostExecutable -Force

    $powershellExecutable = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $arguments = '--run "' + $powershellExecutable + '" "' + $launcherScript + '" "' + $config + '" "' + $installRoot + '" "' + $NodePath + '" "' + $TaskName + '"'
    $action = New-ScheduledTaskAction -Execute $taskHostExecutable -Argument $arguments -WorkingDirectory $installRoot
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -Disable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

    try {
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Disabled ARIA worker task; console-less WinExe host; enable only after separate human authorization.' | Out-Null

        [xml]$taskXml = Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $logonTrigger = $taskXml.SelectSingleNode("//*[local-name()='LogonTrigger']")
        if ($null -eq $logonTrigger) {
            throw 'Registered task XML has no LogonTrigger.'
        }
        $userIdNode = $logonTrigger.SelectSingleNode("./*[local-name()='UserId']")
        if ($null -eq $userIdNode) {
            throw 'Registered task XML has no user-specific LogonTrigger/UserId.'
        }
        $existingDelay = $logonTrigger.SelectSingleNode("./*[local-name()='Delay']")
        if ($null -ne $existingDelay) {
            $logonTrigger.RemoveChild($existingDelay) | Out-Null
        }
        $delayNode = $taskXml.CreateElement('Delay', $taskXml.DocumentElement.NamespaceURI)
        $delayNode.InnerText = 'PT30S'
        $userIdNode.ParentNode.InsertAfter($delayNode, $userIdNode) | Out-Null

        $settingsNode = $taskXml.SelectSingleNode("//*[local-name()='Settings']")
        $enabledNode = $settingsNode.SelectSingleNode("./*[local-name()='Enabled']")
        if ($null -eq $enabledNode) {
            throw 'Registered task XML has no Settings/Enabled node.'
        }
        $enabledNode.InnerText = 'false'

        Register-ScheduledTask -TaskName $TaskName -Xml $taskXml.OuterXml -Force | Out-Null

        $registeredTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $registeredTaskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
        [xml]$verifiedTaskXml = Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $verifiedTrigger = $verifiedTaskXml.SelectSingleNode("//*[local-name()='LogonTrigger']")
        $verifiedDelayNode = if ($null -ne $verifiedTrigger) { $verifiedTrigger.SelectSingleNode("./*[local-name()='Delay']") } else { $null }
        $verifiedAction = $registeredTask.Actions | Select-Object -First 1
        $expectedPrincipal = $currentIdentity.User.Value
        $principalName = [string]$registeredTask.Principal.UserId
        $principalSid = $null
        try {
            $accountName = if ($principalName -notmatch '\\' -and $principalName -notmatch '^S-1-') { "$env:COMPUTERNAME\$principalName" } else { $principalName }
            $principalSid = (New-Object System.Security.Principal.NTAccount($accountName)).Translate([System.Security.Principal.SecurityIdentifier]).Value
        }
        catch {
            try { $principalSid = (New-Object System.Security.Principal.SecurityIdentifier($principalName)).Value } catch {}
        }

        if ([string]$registeredTask.State -ne 'Disabled') {
            throw 'Scheduled task state could not be verified as Disabled.'
        }
        if ($principalSid -ne $expectedPrincipal) {
            throw 'Scheduled task principal SID does not match the DPAPI current-user SID.'
        }
        if ([string]$registeredTask.Principal.LogonType -ne 'Interactive') {
            throw 'Scheduled task must use the interactive current-user logon token.'
        }
        if ($null -eq $verifiedDelayNode -or $verifiedDelayNode.InnerText -ne 'PT30S') {
            throw 'Scheduled task logon delay was not preserved as PT30S.'
        }
        if ([string]$verifiedAction.Execute -ne $taskHostExecutable) {
            throw 'Scheduled task action does not point to the compiled Windows GUI task host.'
        }
        if ([string]$registeredTaskInfo.LastTaskResult -ne '267011') {
            # 0x41303 = task has not yet run; a new task can also report 0.
            # This field is informational only and is never used as an installation gate.
            Write-Verbose ('New scheduled task LastTaskResult=' + $registeredTaskInfo.LastTaskResult)
        }
    }
    catch {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        throw
    }

    Write-Output ('ARIA_WORKER_TASK_REGISTERED=' + $TaskName)
    Write-Output 'ARIA_WORKER_TASK_TRIGGER=AtLogOn'
    Write-Output 'ARIA_WORKER_TASK_PRIVILEGE=Limited'
    Write-Output 'ARIA_WORKER_TASK_STATE=Disabled'
    Write-Output 'ARIA_WORKER_TASK_STARTED=false'
    Write-Output 'ARIA_WORKER_TASK_SECRET_STORAGE=DPAPI current-user config; token is not stored in task arguments.'
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
    $supervisorDecision = Get-ARIAWorkerSupervisorDecision -ExitCode $exitCode
    if ($supervisorDecision -eq 'stop') {
        Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Worker exited cleanly with code 0; supervisor stopping without restart."
        exit 0
    }
    Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Worker exited with code $exitCode; restarting in $delaySeconds seconds."
    Start-Sleep -Seconds $delaySeconds
    $delaySeconds = [Math]::Min(60, $delaySeconds * 2)
}
