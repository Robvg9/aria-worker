[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,

    [string]$ConfigPath,

    [string]$TaskName = 'ARIA Persistent Windows Worker',

    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'This migration is supported only on Windows.'
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid = $identity.User.Value
$installRoot = (Resolve-Path -LiteralPath $InstallDir).Path.TrimEnd('\')
$adapterPath = Join-Path $installRoot 'autonomy\aria-windows-execution-adapter-v1.js'

if (-not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
    throw 'The execution-only adapter is missing from InstallDir.'
}
if (-not (Test-Path -LiteralPath (Join-Path $installRoot 'scripts\aria-persistent-windows-worker-v1.js') -PathType Leaf)) {
    throw 'The current Windows worker entrypoint is missing from InstallDir.'
}

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $env:LOCALAPPDATA 'ARIA\worker\worker.config.json'
}
$ConfigPath = [System.IO.Path]::GetFullPath($ConfigPath)
$expectedConfigDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ARIA\worker'))
if (-not [string]::Equals(
    (Split-Path -Parent $ConfigPath).TrimEnd('\'),
    $expectedConfigDirectory.TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw 'ConfigPath must remain inside the current user ARIA worker profile.'
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
    throw 'The existing DPAPI worker configuration was not found.'
}

$document = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop
if ($document.format -ne 'aria-worker-config-dpapi-v1' -or
    [string]$document.protectedForSid -ne $currentSid -or
    [string]::IsNullOrWhiteSpace([string]$document.workerTokenDpapi)) {
    throw 'The existing DPAPI config does not belong to the current user or has no protected worker token.'
}

$values = $document.values
if (-not $values) { throw 'DPAPI worker config has no values object.' }
$controlUri = $null
if (-not [Uri]::TryCreate([string]$values.ARIA_CONTROL_URL, [UriKind]::Absolute, [ref]$controlUri) -or
    $controlUri.Scheme -ne 'https' -or $controlUri.UserInfo -or $controlUri.Query -or
    $controlUri.Fragment -or ($controlUri.AbsolutePath -ne '/' -and $controlUri.AbsolutePath -ne '')) {
    throw 'The existing coordinator URL is not a valid HTTPS origin.'
}

$workspaceRoot = [string]$values.ARIA_WORKSPACE_ROOT
if (-not $workspaceRoot -or -not (Test-Path -LiteralPath $workspaceRoot -PathType Container)) {
    throw 'The configured worker workspace does not exist.'
}
if (-not [string]::Equals(
    [System.IO.Path]::GetFullPath($workspaceRoot).TrimEnd('\'),
    $installRoot,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw 'The configured workspace root differs from InstallDir. Review before migration.'
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if ([string]$task.State -ne 'Disabled' -or $task.Settings.Enabled -ne $false) {
    throw "Refusing migration: task must remain Disabled (current state=$($task.State), enabled=$($task.Settings.Enabled))."
}
$principalName = [string]$task.Principal.UserId
$principalSid = $null
try {
    if ($principalName -notmatch '\\' -and $principalName -notmatch '^S-1-') {
        $principalName = "$env:COMPUTERNAME\$principalName"
    }
    $principalSid = (New-Object System.Security.Principal.NTAccount($principalName)).Translate(
        [System.Security.Principal.SecurityIdentifier]
    ).Value
}
catch {
    try {
        $principalSid = (New-Object System.Security.Principal.SecurityIdentifier([string]$task.Principal.UserId)).Value
    }
    catch {}
}
if ($principalSid -ne $currentSid) {
    throw 'Scheduled task principal SID does not match the current interactive user.'
}
if ([string]$task.Principal.LogonType -ne 'Interactive' -or
    [string]$task.Principal.RunLevel -ne 'Limited') {
    throw 'Scheduled task must retain Interactive logon and Limited run level.'
}
[xml]$originalTaskXml = Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$originalTriggersNode = $originalTaskXml.SelectSingleNode("//*[local-name()='Triggers']")
$originalPrincipalNode = $originalTaskXml.SelectSingleNode("//*[local-name()='Principals']/*[local-name()='Principal']")
$originalLogonTrigger = $originalTaskXml.SelectSingleNode("//*[local-name()='LogonTrigger']")
if ($null -eq $originalTriggersNode -or $null -eq $originalPrincipalNode -or $null -eq $originalLogonTrigger) {
    throw 'Existing task does not have the expected explicit LogonTrigger and Principal nodes.'
}
$originalLogonUser = $originalLogonTrigger.SelectSingleNode("./*[local-name()='UserId']")
$originalLogonDelay = $originalLogonTrigger.SelectSingleNode("./*[local-name()='Delay']")
$logonUserSid = $null
if ($null -ne $originalLogonUser) {
    try {
        $logonUserSid = (New-Object System.Security.Principal.NTAccount([string]$originalLogonUser.InnerText)).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        try { $logonUserSid = (New-Object System.Security.Principal.SecurityIdentifier([string]$originalLogonUser.InnerText)).Value } catch {}
    }
}
if ($null -eq $originalLogonUser -or
    $logonUserSid -ne $currentSid -or
    $null -eq $originalLogonDelay -or
    [string]$originalLogonDelay.InnerText -ne 'PT30S') {
    throw 'Existing task must retain a user-specific 30-second logon trigger for the current SID.'
}
$originalTriggersXml = $originalTriggersNode.OuterXml
$originalPrincipalXml = $originalPrincipalNode.OuterXml

$oldAction = $task.Actions | Select-Object -First 1
$hostExecutable = [System.IO.Path]::GetFullPath([string]$oldAction.Execute)
$expectedHost = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ARIA\worker\aria-worker-task-host.exe'))
if (-not [string]::Equals($hostExecutable, $expectedHost, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not (Test-Path -LiteralPath $hostExecutable -PathType Leaf)) {
    throw 'Existing task host executable is missing or is outside the current user ARIA worker profile.'
}
$argumentPattern = '^\s*--run\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"\s+"([^"]+)"\s*$'
$oldArgs = [regex]::Match([string]$oldAction.Arguments, $argumentPattern)
if (-not $oldArgs.Success) {
    throw 'Existing task action arguments are not in the expected --run format.'
}
$oldConfigPath = [System.IO.Path]::GetFullPath($oldArgs.Groups[1].Value)
$oldInstallRoot = [System.IO.Path]::GetFullPath($oldArgs.Groups[2].Value)
$nodePath = [System.IO.Path]::GetFullPath($oldArgs.Groups[3].Value)
$oldTaskName = $oldArgs.Groups[4].Value
if (-not [string]::Equals($oldConfigPath, $ConfigPath, [System.StringComparison]::OrdinalIgnoreCase) -or
    $oldTaskName -ne $TaskName) {
    throw 'Existing task action references a different config or task name.'
}
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw 'The Node executable referenced by the existing task does not exist.'
}
if ($oldInstallRoot -eq $installRoot) {
    Write-Output 'ARIA_EXECUTION_ONLY_TASK_ALREADY_POINTS_TO_CURRENT_ROOT=true'
}

foreach ($name in @(
    'ARIA_PACKAGE3_SCOPE_PROBE_ID',
    'ARIA_PACKAGE3_SCOPE_TOKEN',
    'ARIA_PACKAGE3_LEASE_EVIDENCE_DIR'
)) {
    foreach ($target in @('Process', 'User', 'Machine')) {
        if (-not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, $target))) {
            throw "Refusing migration because temporary Package 3 scope variable $name is set in $target scope."
        }
    }
}

# Preserve the encrypted DPAPI token bytes exactly; update only non-secret values.
$newValues = [ordered]@{}
foreach ($property in $values.PSObject.Properties) {
    if ($property.Name -in @('ARIA_OLLAMA_URL', 'ARIA_OLLAMA_MODEL', 'ARIA_OLLAMA_TIMEOUT_MS', 'ARIA_AUTONOMY_ADAPTER')) {
        continue
    }
    $newValues[$property.Name] = $property.Value
}
$newValues['ARIA_AUTONOMY_ADAPTER'] = $adapterPath
$newValues['ARIA_WORKSPACE_ROOT'] = $workspaceRoot

$newDocument = [ordered]@{
    format = [string]$document.format
    protectedForSid = [string]$document.protectedForSid
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    workerTokenDpapi = [string]$document.workerTokenDpapi
    values = $newValues
}
$newJson = $newDocument | ConvertTo-Json -Depth 8
$newArguments = '--run "' + $ConfigPath + '" "' + $installRoot + '" "' + $nodePath + '" "' + $TaskName + '"'
$newAction = New-ScheduledTaskAction -Execute $hostExecutable -Argument $newArguments -WorkingDirectory $installRoot

Write-Output 'ARIA_EXECUTION_ONLY_MIGRATION_READY=true'
Write-Output ('TASK=' + $TaskName)
Write-Output ('OLD_INSTALL_ROOT=' + $oldInstallRoot)
Write-Output ('NEW_INSTALL_ROOT=' + $installRoot)
Write-Output ('NEW_ADAPTER=' + $adapterPath)
Write-Output ('WORKSPACE_ROOT=' + $workspaceRoot)
Write-Output ('CONFIG_OWNER_SID_MATCH=true')
Write-Output ('TASK_PRINCIPAL_SID_MATCH=true')
Write-Output ('TASK_REMAINS_DISABLED=' + [string]($task.State -eq 'Disabled' -and $task.Settings.Enabled -eq $false))
Write-Output 'DPAPI_TOKEN_REENCRYPTION=NO'
Write-Output 'OLLAMA_CONFIG_KEYS=REMOVE'
Write-Output 'TASK_ENABLE_OR_START=NO'

if (-not $Apply) {
    Write-Output 'DRY_RUN_ONLY=true'
    Write-Output 'NEXT_ACTION=RERUN_WITH_-Apply_TO_UPDATE_CONFIG_AND_TASK_ACTION_WHILE_DISABLED'
    exit 0
}

$originalConfigRaw = Get-Content -LiteralPath $ConfigPath -Raw
$originalConfigAcl = Get-Acl -LiteralPath $ConfigPath
$tempPath = $ConfigPath + '.execution-only.tmp'
$configReplaced = $false
$taskActionChanged = $false

try {
    [System.IO.File]::WriteAllText($tempPath, $newJson, ([System.Text.UTF8Encoding]::new($false)))
    Set-Acl -LiteralPath $tempPath -AclObject $originalConfigAcl
    [System.IO.File]::Replace($tempPath, $ConfigPath, $null)
    $configReplaced = $true

    Set-ScheduledTask -TaskName $TaskName -TaskPath $task.TaskPath -Action $newAction | Out-Null
    $taskActionChanged = $true

    $verifiedTask = Get-ScheduledTask -TaskName $TaskName -TaskPath $task.TaskPath -ErrorAction Stop
    $verifiedAction = $verifiedTask.Actions | Select-Object -First 1
    [xml]$verifiedTaskXml = Export-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $verifiedTriggersNode = $verifiedTaskXml.SelectSingleNode("//*[local-name()='Triggers']")
    $verifiedPrincipalNode = $verifiedTaskXml.SelectSingleNode("//*[local-name()='Principals']/*[local-name()='Principal']")
    if ($null -eq $verifiedTriggersNode -or $null -eq $verifiedPrincipalNode -or
        $verifiedTriggersNode.OuterXml -cne $originalTriggersXml -or
        $verifiedPrincipalNode.OuterXml -cne $originalPrincipalXml) {
        throw 'Post-update verification failed: task trigger or principal XML changed.'
    }
    $verifiedArgs = [regex]::Match([string]$verifiedAction.Arguments, $argumentPattern)
    $verifiedIdentity = [string]$verifiedTask.Principal.UserId
    $verifiedSid = $null
    try {
        if ($verifiedIdentity -notmatch '\\' -and $verifiedIdentity -notmatch '^S-1-') {
            $verifiedIdentity = "$env:COMPUTERNAME\$verifiedIdentity"
        }
        $verifiedSid = (New-Object System.Security.Principal.NTAccount($verifiedIdentity)).Translate(
            [System.Security.Principal.SecurityIdentifier]
        ).Value
    }
    catch {
        try { $verifiedSid = (New-Object System.Security.Principal.SecurityIdentifier([string]$verifiedTask.Principal.UserId)).Value } catch {}
    }

    if ([string]$verifiedTask.State -ne 'Disabled' -or $verifiedTask.Settings.Enabled -ne $false) {
        throw 'Post-update verification failed: task is not Disabled.'
    }
    if ($verifiedSid -ne $currentSid -or
        [string]$verifiedTask.Principal.LogonType -ne 'Interactive' -or
        [string]$verifiedTask.Principal.RunLevel -ne 'Limited') {
        throw 'Post-update verification failed: principal, logon type, or run level changed.'
    }
    if (-not $verifiedArgs.Success -or
        -not [string]::Equals([System.IO.Path]::GetFullPath($verifiedArgs.Groups[1].Value), $ConfigPath, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([System.IO.Path]::GetFullPath($verifiedArgs.Groups[2].Value), $installRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
        -not [string]::Equals([System.IO.Path]::GetFullPath($verifiedArgs.Groups[3].Value), $nodePath, [System.StringComparison]::OrdinalIgnoreCase) -or
        $verifiedArgs.Groups[4].Value -ne $TaskName -or
        -not [string]::Equals([System.IO.Path]::GetFullPath([string]$verifiedAction.Execute), $hostExecutable, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Post-update verification failed: task action does not point to the new package4 install root.'
    }

    $readback = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json -ErrorAction Stop
    if ([string]$readback.workerTokenDpapi -cne [string]$document.workerTokenDpapi -or
        [string]$readback.protectedForSid -ne $currentSid -or
        [string]$readback.values.ARIA_AUTONOMY_ADAPTER -ne $adapterPath -or
        $readback.values.PSObject.Properties.Name -contains 'ARIA_OLLAMA_MODEL' -or
        $readback.values.PSObject.Properties.Name -contains 'ARIA_OLLAMA_URL') {
        throw 'Post-update verification failed: DPAPI token or execution-only config readback mismatch.'
    }

    Write-Output 'ARIA_EXECUTION_ONLY_CONFIG_UPDATE=PASS'
    Write-Output 'ARIA_EXECUTION_ONLY_TASK_ACTION_UPDATE=PASS'
    Write-Output 'ARIA_DPAPI_CIPHERTEXT_PRESERVED=PASS'
    Write-Output 'ARIA_TASK_DISABLED_PRESERVED=PASS'
    Write-Output 'ARIA_TASK_PRINCIPAL_AND_TRIGGER_PRESERVED=PASS'
}
catch {
    $failure = $_
    if ($taskActionChanged) {
        try { Set-ScheduledTask -TaskName $TaskName -TaskPath $task.TaskPath -Action $oldAction | Out-Null } catch {}
    }
    if ($configReplaced) {
        try {
            $rollbackPath = $ConfigPath + '.rollback.tmp'
            [System.IO.File]::WriteAllText($rollbackPath, $originalConfigRaw, ([System.Text.UTF8Encoding]::new($false)))
            Set-Acl -LiteralPath $rollbackPath -AclObject $originalConfigAcl
            [System.IO.File]::Replace($rollbackPath, $ConfigPath, $null)
        }
        catch {}
    }
    throw $failure
}
finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath ($ConfigPath + '.rollback.tmp') -Force -ErrorAction SilentlyContinue
    $document = $null
    $newDocument = $null
    $newJson = $null
    $originalConfigRaw = $null
}
