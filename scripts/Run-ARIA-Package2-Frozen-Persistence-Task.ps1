[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$InstallDir,
    [Parameter(Mandatory = $true)][string]$NodePath,
    [string]$TaskName = 'ARIA Persistent Windows Worker'
)

$ErrorActionPreference = 'Stop'
$taskDisabled = $false
$processExited = $false
$workerStoppedByFreeze = $false
$supervisorCleanStop = $false
$startCount = 0
$failure = $null
$logFile = Join-Path $env:LOCALAPPDATA 'ARIA\logs\persistent-worker-supervisor.log'
$evidenceDirectory = Join-Path $env:ProgramData 'ARIA\Package2'
$evidencePath = Join-Path $evidenceDirectory 'persistence-probe-result.json'

function Stop-ARIAProbeProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue)
    foreach ($child in $children) {
        Stop-ARIAProbeProcessTree -ProcessId ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}

try {
    if ($env:COMPUTERNAME -ne 'ROBVG') {
        throw 'Frozen persistence task refuses to run outside ROBVG.'
    }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw 'DPAPI worker configuration is missing.'
    }
    $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop
    if ([string]$config.format -ne 'aria-worker-config-dpapi-v1') {
        throw 'DPAPI worker config format is not recognized.'
    }
    if ([string]$config.protectedForSid -ne $identity.User.Value) {
        throw 'DPAPI worker config does not belong to the scheduled-task identity.'
    }

    $workerSource = Get-Content -LiteralPath (Join-Path $InstallDir 'cloudflare-autonomy\worker.mjs') -Raw
    if ($workerSource -notmatch 'MISSION_EXECUTION_PAUSED\s*=\s*true') {
        throw 'Coordinator source no longer has the hard execution freeze; refusing the persistence probe.'
    }

    $supervisor = Join-Path $InstallDir 'scripts\Start-ARIA-Persistent-Worker.ps1'
    $powershell = (Get-Process -Id $PID).Path
    $stdoutPath = Join-Path (Split-Path -Parent $logFile) 'package2-task-supervisor.stdout.log'
    $stderrPath = Join-Path (Split-Path -Parent $logFile) 'package2-task-supervisor.stderr.log'
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logFile) | Out-Null

    $arguments = @(
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $supervisor + '"'),
        '-ConfigPath', ('"' + $ConfigPath + '"'),
        '-InstallDir', ('"' + $InstallDir + '"'),
        '-NodePath', ('"' + $NodePath + '"'),
        '-TaskName', ('"' + $TaskName + '"')
    )
    $process = Start-Process -FilePath $powershell -ArgumentList $arguments -PassThru -NoNewWindow -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
    if (-not $process.WaitForExit(60000)) {
        Stop-ARIAProbeProcessTree -ProcessId $process.Id
        throw 'Worker supervisor did not stop within 60 seconds; child process tree terminated.'
    }
    $process.Refresh()
    $processExited = [bool]$process.HasExited

    if (-not (Test-Path -LiteralPath $logFile -PathType Leaf)) {
        throw 'Worker supervisor log was not created.'
    }
    $log = [System.IO.File]::ReadAllText($logFile).Replace([string][char]0, '')
    $workerStoppedByFreeze = $log.Contains('ARIA_WINDOWS_WORKER_STOPPED=MISSION_EXECUTION_PAUSED')
    $supervisorCleanStop = $log.Contains('Worker exited cleanly with code 0; supervisor stopping without restart.')
    $startCount = [regex]::Matches($log, 'Starting ARIA Windows worker\.').Count
    if (-not $processExited) {
        throw 'Supervisor process has not exited.'
    }
    if (-not $workerStoppedByFreeze) {
        throw 'Worker did not stop with MISSION_EXECUTION_PAUSED.'
    }
    if (-not $supervisorCleanStop) {
        throw 'Supervisor did not log the clean exit-code-0 stop.'
    }
    if ($startCount -ne 1) {
        throw "Expected exactly one worker start; observed $startCount."
    }
}
catch {
    $failure = [string]$_.Exception.Message
}
finally {
    try {
        Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null
        $afterDisable = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        $taskDisabled = ([string]$afterDisable.State -eq 'Disabled')
    }
    catch {
        if (-not $failure) { $failure = 'Could not disable or verify the frozen persistence task after its one-shot run.' }
    }

    try {
        $evidence = [ordered]@{
            format = 'aria-package2-frozen-persistence-result-v1'
            completedAtUtc = [DateTime]::UtcNow.ToString('o')
            host = $env:COMPUTERNAME
            taskName = $TaskName
            taskIdentitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
            workerProcessExited = $processExited
            workerStoppedByMissionFreeze = $workerStoppedByFreeze
            supervisorCleanStop = $supervisorCleanStop
            workerStartCount = $startCount
            taskDisabledAfterRun = $taskDisabled
            status = if (-not $failure -and $processExited -and $workerStoppedByFreeze -and $supervisorCleanStop -and $startCount -eq 1 -and $taskDisabled) { 'PASS' } else { 'FAIL' }
            failure = $failure
        }
        $json = $evidence | ConvertTo-Json -Depth 5
        [System.IO.Directory]::CreateDirectory($evidenceDirectory) | Out-Null

        $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
        $directoryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
        $directoryAcl.SetAccessRuleProtection($true, $false)
        $directoryAcl.SetOwner($identity.User)
        $currentRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity.User,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $networkServiceSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-20')
        $networkRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $networkServiceSid,
            [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$directoryAcl.AddAccessRule($currentRule)
        [void]$directoryAcl.AddAccessRule($networkRule)
        Set-Acl -LiteralPath $evidenceDirectory -AclObject $directoryAcl

        $tempEvidence = $evidencePath + '.tmp'
        [System.IO.File]::WriteAllText($tempEvidence, $json, ([System.Text.UTF8Encoding]::new($false)))
        $fileAcl = [System.Security.AccessControl.FileSecurity]::new()
        $fileAcl.SetAccessRuleProtection($true, $false)
        $fileAcl.SetOwner($identity.User)
        $fileCurrentRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $identity.User,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        $fileNetworkRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $networkServiceSid,
            [System.Security.AccessControl.FileSystemRights]::Read,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$fileAcl.AddAccessRule($fileCurrentRule)
        [void]$fileAcl.AddAccessRule($fileNetworkRule)
        Set-Acl -LiteralPath $tempEvidence -AclObject $fileAcl
        Move-Item -LiteralPath $tempEvidence -Destination $evidencePath -Force
        $json = $null
        $evidence = $null
    }
    catch {
        if (-not $failure) { $failure = 'Could not write the read-only persistence evidence file for the runner.' }
    }
}

if (-not $failure -and $taskDisabled -and $processExited -and $workerStoppedByFreeze -and $supervisorCleanStop -and $startCount -eq 1) {
    Write-Output 'ARIA_PACKAGE2_PERSISTENCE_PROBE=PASS'
    Write-Output 'ARIA_PACKAGE2_WORKER_STOPPED_BY_FREEZE=PASS'
    Write-Output 'ARIA_PACKAGE2_TASK_DISABLED_AFTER_RUN=PASS'
    Write-Output ('ARIA_PACKAGE2_EVIDENCE_PATH=' + $evidencePath)
    exit 0
}

Write-Output 'ARIA_PACKAGE2_PERSISTENCE_PROBE=FAIL'
Write-Output ('ARIA_PACKAGE2_FAILURE=' + [string]$failure)
Write-Output ('ARIA_PACKAGE2_TASK_DISABLED=' + [string]$taskDisabled)
exit 1
