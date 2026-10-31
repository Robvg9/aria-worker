[CmdletBinding()]
param(
    [switch]$EnableAndReboot,
    [string]$InstallDir,
    [string]$NodePath = 'D:\Databank\node\node.exe',
    [string]$ControlUrl = 'https://aria-autonomy-coordinator.robvg9.workers.dev',
    [string]$TaskName = 'ARIA Persistent Windows Worker'
)

$ErrorActionPreference = 'Stop'
$registeredTask = $false
$configCreated = $false
$secureToken = $null
$tokenPointer = [IntPtr]::Zero
$plainToken = $null

try {
    if ($env:OS -ne 'Windows_NT') {
        throw 'This installer can only run on Windows.'
    }
    if ($env:COMPUTERNAME -ne 'ROBVG') {
        throw 'This controlled persistence test is restricted to ROBVG.'
    }

    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $sessionId = (Get-Process -Id $PID).SessionId
    if (-not [Environment]::UserInteractive -or $sessionId -eq 0) {
        throw 'Open PowerShell in the logged-in Windows desktop session; session 0 services cannot create this DPAPI task.'
    }
    if ($identity.User.Value -in @('S-1-5-18', 'S-1-5-20') -or $identity.Name -match '(?i)NETWORK SERVICE|LOCAL SYSTEM') {
        throw 'Run this installer as your normal interactive Windows user, not SYSTEM or NETWORK SERVICE.'
    }

    $shellOwners = @()
    foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction SilentlyContinue)) {
        try {
            $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwner -ErrorAction Stop
            if ($owner.ReturnValue -eq 0) {
                $shellOwners += ($owner.Domain + '\' + $owner.User)
            }
        }
        catch {}
    }
    $shellOwners = @($shellOwners | Select-Object -Unique)
    if ($shellOwners.Count -eq 0 -or @($shellOwners | Where-Object { $_.ToLowerInvariant() -eq $identity.Name.ToLowerInvariant() }).Count -eq 0) {
        throw 'The current account does not own an active Explorer desktop session. Sign in to the intended Windows user first.'
    }

    if (-not $InstallDir) {
        $InstallDir = 'D:\Databank\aria-worker-package4'
    }
    $installRoot = (Resolve-Path -LiteralPath $InstallDir).Path.TrimEnd('\')
    $expectedInstallRoot = [System.IO.Path]::GetFullPath('D:\Databank\aria-worker-package4').TrimEnd('\')
    if (-not [string]::Equals($installRoot, $expectedInstallRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'InstallDir must be the stable D:\Databank\aria-worker-package4 checkout.'
    }
    $workerSourcePath = Join-Path $installRoot 'cloudflare-autonomy\worker.mjs'
    $supervisorPath = Join-Path $installRoot 'scripts\Start-ARIA-Persistent-Worker.ps1'
    $supervisorPolicyPath = Join-Path $installRoot 'scripts\aria-worker-supervisor-policy-v1.ps1'
    $workerPath = Join-Path $installRoot 'scripts\aria-persistent-windows-worker-v1.js'
    $workerErrorPolicyPath = Join-Path $installRoot 'autonomy\persistent-worker-error-policy-v1.js'
    $adapterPath = Join-Path $installRoot 'tests\fixtures\aria-frozen-worker-probe-adapter.js'
    $wrapperPath = Join-Path $installRoot 'scripts\Run-ARIA-Package2-Frozen-Persistence-Task.ps1'

    foreach ($requiredPath in @($workerSourcePath, $supervisorPath, $supervisorPolicyPath, $workerPath, $workerErrorPolicyPath, $adapterPath, $wrapperPath)) {
        if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
            throw "Required frozen persistence probe source is missing: $requiredPath. Update the stable checkout to main before running this installer."
        }
    }
    $workerSource = Get-Content -LiteralPath $workerSourcePath -Raw
    if ($workerSource -notmatch 'MISSION_EXECUTION_PAUSED\s*=\s*true') {
        throw 'Coordinator source does not have the hard execution freeze. Refusing task installation.'
    }

    if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) {
        $nodeCommand = Get-Command node -ErrorAction Stop
        $NodePath = $nodeCommand.Source
    }
    $nodeVersion = (& $NodePath --version).Trim()
    if ([version]($nodeVersion.TrimStart('v')) -lt [version]'20.0.0') {
        throw "Node 20+ required; found $nodeVersion"
    }

    $controlUri = $null
    if (-not [Uri]::TryCreate($ControlUrl, [UriKind]::Absolute, [ref]$controlUri) -or
        $controlUri.Scheme -ne 'https' -or
        $controlUri.UserInfo -or
        $controlUri.Query -or
        $controlUri.Fragment -or
        ($controlUri.AbsolutePath -ne '/' -and $controlUri.AbsolutePath -ne '')) {
        throw 'ControlUrl must be an HTTPS origin without credentials, query, fragment or path.'
    }
    $controlBase = $controlUri.GetLeftPart([UriPartial]::Authority)

    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        throw "A task named '$TaskName' already exists. Review it manually; this installer never replaces an existing task."
    }

    $localAppData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    $configDirectory = Join-Path $localAppData 'ARIA\worker'
    $configPath = Join-Path $configDirectory 'worker.config.json'
    if (Test-Path -LiteralPath $configPath) {
        throw "A worker config already exists at $configPath. It will not be overwritten."
    }
    $workspace = Join-Path $configDirectory 'package2-frozen-workspace'
    $evidenceDirectory = Join-Path $env:ProgramData 'ARIA\Package2'
    $evidencePath = Join-Path $evidenceDirectory 'persistence-probe-result.json'

    $secureToken = Read-Host 'Enter the existing ARIA_AUTONOMY_WORKER_TOKEN (input is hidden)' -AsSecureString
    if (-not $secureToken -or $secureToken.Length -lt 32) {
        throw 'Worker token must contain at least 32 characters.'
    }
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $plainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)

    function Invoke-AriaPersistenceHttpProbe {
        param(
            [Parameter(Mandatory = $true)][string]$Uri,
            [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
            [string]$Body,
            [string]$BearerToken
        )
        $request = [System.Net.HttpWebRequest]::Create($Uri)
        $request.Method = $Method
        $request.Timeout = 12000
        $request.ReadWriteTimeout = 12000
        $request.KeepAlive = $false
        if ($Method -eq 'POST') {
            $request.ContentType = 'application/json'
            $request.Headers['Authorization'] = 'Bearer ' + $BearerToken
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
            $request.ContentLength = $bytes.Length
            $stream = $request.GetRequestStream()
            try { $stream.Write($bytes, 0, $bytes.Length) }
            finally { $stream.Dispose() }
        }
        $response = $null
        try {
            $response = $request.GetResponse()
        }
        catch [System.Net.WebException] {
            $response = $_.Exception.Response
            if (-not $response) {
                throw "Coordinator did not respond to $Method $Uri: $($_.Exception.Message)"
            }
        }
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            try { $responseBody = $reader.ReadToEnd() }
            finally { $reader.Dispose() }
            return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $responseBody }
        }
        finally {
            if ($response) { $response.Close() }
        }
    }

    $health = Invoke-AriaPersistenceHttpProbe -Uri ($controlBase + '/health') -Method GET
    if ($health.StatusCode -ne 200) {
        throw "Coordinator health check failed with HTTP $($health.StatusCode)."
    }
    $healthJson = $health.Body | ConvertFrom-Json
    if ($healthJson.ok -ne $true -or $healthJson.supabase_independent -ne $true) {
        throw 'Coordinator health response did not match the independent coordinator contract.'
    }

    $claimBody = @{ worker_id = ('package2-preinstall-' + $env:COMPUTERNAME); capabilities = @() } | ConvertTo-Json -Compress
    $claim = Invoke-AriaPersistenceHttpProbe -Uri ($controlBase + '/api/worker/claim') -Method POST -Body $claimBody -BearerToken $plainToken
    if ($claim.StatusCode -ne 423 -or $claim.Body -notmatch 'mission_execution_paused') {
        throw "Expected frozen coordinator HTTP 423; received HTTP $($claim.StatusCode). No task was created."
    }
    Write-Output 'ROBVG_PREINSTALL_HEALTH=PASS'
    Write-Output 'ROBVG_PREINSTALL_CLAIM_423=PASS'
    Write-Output 'ROBVG_PREINSTALL_CREATED_NO_LEASE=true'

    $encryptedToken = ConvertFrom-SecureString -SecureString $secureToken
    New-Item -ItemType Directory -Force -Path $configDirectory, $workspace, $evidenceDirectory | Out-Null

    $configDirectoryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
    $configDirectoryAcl.SetAccessRuleProtection($true, $false)
    $configDirectoryAcl.SetOwner($identity.User)
    $directoryRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity.User,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$configDirectoryAcl.AddAccessRule($directoryRule)
    Set-Acl -LiteralPath $configDirectory -AclObject $configDirectoryAcl

    $configDocument = [ordered]@{
        format = 'aria-worker-config-dpapi-v1'
        protectedForSid = $identity.User.Value
        createdAtUtc = [DateTime]::UtcNow.ToString('o')
        workerTokenDpapi = $encryptedToken
        values = [ordered]@{
            ARIA_CONTROL_URL = $controlBase
            ARIA_AUTONOMY_ADAPTER = $adapterPath
            ARIA_WORKSPACE_ROOT = $workspace
            ARIA_WORKER_ID = ('package2-frozen-persistence-' + $env:COMPUTERNAME)
            ARIA_WORKER_POLL_MS = '1000'
            ARIA_WORKER_HEARTBEAT_MS = '15000'
        }
    }
    $json = $configDocument | ConvertTo-Json -Depth 6
    $tempConfig = $configPath + '.tmp'
    [System.IO.File]::WriteAllText($tempConfig, $json, ([System.Text.UTF8Encoding]::new($false)))
    $configFileAcl = [System.Security.AccessControl.FileSecurity]::new()
    $configFileAcl.SetAccessRuleProtection($true, $false)
    $configFileAcl.SetOwner($identity.User)
    $configFileRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity.User,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$configFileAcl.AddAccessRule($configFileRule)
    Set-Acl -LiteralPath $tempConfig -AclObject $configFileAcl
    Move-Item -LiteralPath $tempConfig -Destination $configPath
    $configCreated = $true
    $json = $null
    $configDocument = $null
    $encryptedToken = $null

    $evidenceDirectoryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
    $evidenceDirectoryAcl.SetAccessRuleProtection($true, $false)
    $evidenceDirectoryAcl.SetOwner($identity.User)
    $evidenceUserRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $identity.User,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    $systemSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
    $adminSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
    $systemEvidenceRule = [System.Security.AccessControl.FileSystemAccessRule]::new($systemSid, [System.Security.AccessControl.FileSystemRights]::FullControl, ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $adminEvidenceRule = [System.Security.AccessControl.FileSystemAccessRule]::new($adminSid, [System.Security.AccessControl.FileSystemRights]::FullControl, ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit), [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    $networkServiceSid = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-20')
    $evidenceNetworkRule = [System.Security.AccessControl.FileSystemAccessRule]::new(
        $networkServiceSid,
        [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$evidenceDirectoryAcl.AddAccessRule($evidenceUserRule)
    [void]$evidenceDirectoryAcl.AddAccessRule($systemEvidenceRule)
    [void]$evidenceDirectoryAcl.AddAccessRule($adminEvidenceRule)
    [void]$evidenceDirectoryAcl.AddAccessRule($evidenceNetworkRule)
    Set-Acl -LiteralPath $evidenceDirectory -AclObject $evidenceDirectoryAcl

    $powershellExe = (Get-Process -Id $PID).Path
    $taskArguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $wrapperPath + '" -ConfigPath "' + $configPath + '" -InstallDir "' + $installRoot + '" -NodePath "' + $NodePath + '" -TaskName "' + $TaskName + '"'
    $action = New-ScheduledTaskAction -Execute $powershellExe -Argument $taskArguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
    $principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 2) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew

    try {
        Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'One-shot frozen ARIA persistence probe; wrapper disables this task after its single run.' | Out-Null
        $registeredTask = $true
        Disable-ScheduledTask -TaskName $TaskName | Out-Null
        $createdTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        if ([string]$createdTask.State -ne 'Disabled') {
            throw 'New persistence probe task did not verify Disabled after registration.'
        }
    }
    catch {
        if ($registeredTask) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
            $registeredTask = $false
        }
        throw
    }

    Write-Output ('ARIA_PACKAGE2_TASK_CREATED=' + $TaskName)
    Write-Output 'ARIA_PACKAGE2_TASK_PRINCIPAL=INTERACTIVE_CURRENT_USER'
    Write-Output 'ARIA_PACKAGE2_TASK_LOGON_TYPE=Interactive'
    Write-Output 'ARIA_PACKAGE2_TASK_STATE=Disabled'
    Write-Output 'ARIA_PACKAGE2_DPAPI=CurrentUser'
    Write-Output 'ARIA_PACKAGE2_ADAPTER=SAFE_NO_OP'
    Write-Output 'ARIA_PACKAGE2_OLLAMA_USED=false'
    Write-Output 'ARIA_PACKAGE2_TASK_STARTED=false'

    if ($EnableAndReboot) {
        Enable-ScheduledTask -TaskName $TaskName | Out-Null
        $enabledTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
        if ([string]$enabledTask.State -eq 'Disabled') {
            throw 'Could not enable the one-shot persistence probe task.'
        }

        Write-Output 'ARIA_PACKAGE2_TASK_STATE=EnabledForOneReboot'
        Write-Output 'ARIA_PACKAGE2_REBOOT_REQUESTED=true'
        $shutdownExe = Join-Path $env:SystemRoot 'System32\shutdown.exe'
        & $shutdownExe /r /t 30 /c 'ARIA Package 2 frozen persistence test. The worker remains hard-frozen and self-disables after one logon run.'
        if ($LASTEXITCODE -ne 0) {
            Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
            throw "Windows rejected the controlled reboot request (exit $LASTEXITCODE); task returned to Disabled."
        }
        Write-Output 'ARIA_PACKAGE2_REBOOT_SCHEDULED=true'
    }
    else {
        Write-Output 'ARIA_PACKAGE2_NEXT=Run the script again with -EnableAndReboot after reviewing the disabled task.'
    }
}
catch {
    if ($registeredTask) {
        Disable-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | Out-Null
    }
    if ($configCreated -and -not $registeredTask) {
        Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
    }
    throw
}
finally {
    $plainToken = $null
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    if ($secureToken) {
        $secureToken.Dispose()
    }
}
