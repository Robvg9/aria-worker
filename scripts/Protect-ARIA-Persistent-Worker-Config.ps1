[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InstallDir,

    [Parameter(Mandatory = $true)]
    [string]$WorkspaceRoot,

    [Parameter(Mandatory = $true)]
    [string]$OllamaModel,

    [string]$ControlUrl = 'https://aria-autonomy-coordinator.robvg9.workers.dev',

    [string]$OllamaUrl = 'http://127.0.0.1:11434',

    [string]$WorkerId = ($env:COMPUTERNAME + '-aria-worker'),

    [string]$ConfigPath,

    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') {
    throw 'DPAPI worker configuration can only be created on Windows.'
}

$installRoot = (Resolve-Path -LiteralPath $InstallDir).Path
$workspace = (Resolve-Path -LiteralPath $WorkspaceRoot).Path
$adapterPath = Join-Path $installRoot 'autonomy\ollama-persistent-adapter-v1.js'
if (-not (Test-Path -LiteralPath $adapterPath -PathType Leaf)) {
    throw 'Approved Ollama adapter was not found under InstallDir.'
}

$controlUri = $null
if (-not [Uri]::TryCreate($ControlUrl, [UriKind]::Absolute, [ref]$controlUri) -or
    $controlUri.Scheme -ne 'https' -or
    $controlUri.UserInfo -or
    $controlUri.Query -or
    $controlUri.Fragment -or
    ($controlUri.AbsolutePath -ne '/' -and $controlUri.AbsolutePath -ne '')) {
    throw 'ControlUrl must be an HTTPS origin without credentials, query, fragment, or path.'
}

if ([string]::IsNullOrWhiteSpace($OllamaModel)) {
    throw 'OllamaModel is required. Select a model that this PC can run without unacceptable slowdown.'
}

if ([string]::IsNullOrWhiteSpace($WorkerId) -or $WorkerId -match '[\r\n]') {
    throw 'WorkerId is invalid.'
}

if (-not $ConfigPath) {
    $ConfigPath = Join-Path $env:LOCALAPPDATA 'ARIA\worker\worker.config.json'
}
$configDirectory = Split-Path -Parent $ConfigPath
$expectedDirectory = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ARIA\worker'))
$configDirectoryFull = [System.IO.Path]::GetFullPath($configDirectory)
if (-not [string]::Equals(
    $configDirectoryFull.TrimEnd('\'),
    $expectedDirectory.TrimEnd('\'),
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw 'ConfigPath must be inside %LOCALAPPDATA%\ARIA\worker.'
}

if ((Test-Path -LiteralPath $ConfigPath) -and -not $Force) {
    throw 'Protected worker config already exists. Use -Force only after reviewing the existing config.'
}

$workerToken = Read-Host 'Enter the existing ARIA_AUTONOMY_WORKER_TOKEN' -AsSecureString
if (-not $workerToken -or $workerToken.Length -eq 0) {
    throw 'Worker token is required.'
}

$tokenPointer = [IntPtr]::Zero
try {
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($workerToken)
    $tokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer)
    if ($tokenPlain.Length -lt 32) {
        throw 'Worker token must contain at least 32 characters.'
    }
}
finally {
    if ($tokenPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer)
    }
    $tokenPlain = $null
}

# ConvertFrom-SecureString without -Key uses Windows DPAPI for the current user.
$encryptedWorkerToken = ConvertFrom-SecureString -SecureString $workerToken
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$currentSid = $identity.User.Value

$document = [ordered]@{
    format = 'aria-worker-config-dpapi-v1'
    protectedForSid = $currentSid
    createdAtUtc = [DateTime]::UtcNow.ToString('o')
    workerTokenDpapi = $encryptedWorkerToken
    values = [ordered]@{
        ARIA_CONTROL_URL = $controlUri.GetLeftPart([UriPartial]::Authority)
        ARIA_AUTONOMY_ADAPTER = $adapterPath
        ARIA_WORKSPACE_ROOT = $workspace
        ARIA_OLLAMA_URL = $OllamaUrl
        ARIA_OLLAMA_MODEL = $OllamaModel
        ARIA_WORKER_ID = $WorkerId
        ARIA_WORKER_POLL_MS = '2000'
        ARIA_WORKER_HEARTBEAT_MS = '15000'
    }
}

New-Item -ItemType Directory -Path $configDirectoryFull -Force | Out-Null

# Lock this dedicated directory to the current interactive user before writing.
$directoryAcl = New-Object System.Security.AccessControl.DirectorySecurity
$directoryAcl.SetAccessRuleProtection($true, $false)
$directoryAcl.SetOwner($identity.User)
$directoryRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
    $identity.User,
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
)
[void]$directoryAcl.AddAccessRule($directoryRule)
Set-Acl -LiteralPath $configDirectoryFull -AclObject $directoryAcl

$json = $document | ConvertTo-Json -Depth 6
$tempPath = $ConfigPath + '.tmp'
try {
    [System.IO.File]::WriteAllText($tempPath, $json, (New-Object System.Text.UTF8Encoding($false)))

    $fileAcl = New-Object System.Security.AccessControl.FileSecurity
    $fileAcl.SetAccessRuleProtection($true, $false)
    $fileAcl.SetOwner($identity.User)
    $fileRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $identity.User,
        [System.Security.AccessControl.FileSystemRights]::FullControl,
        [System.Security.AccessControl.AccessControlType]::Allow
    )
    [void]$fileAcl.AddAccessRule($fileRule)
    Set-Acl -LiteralPath $tempPath -AclObject $fileAcl

    Move-Item -LiteralPath $tempPath -Destination $ConfigPath -Force
}
finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
    $json = $null
    $document = $null
    $encryptedWorkerToken = $null
    $workerToken.Dispose()
}

Write-Output 'ARIA_WORKER_CONFIG_CREATED=true'
Write-Output 'ARIA_WORKER_CONFIG_PROTECTION=DPAPI_CURRENT_USER'
Write-Output 'ARIA_WORKER_CONFIG_ACL=CURRENT_USER_ONLY'
Write-Output ('ARIA_WORKER_CONFIG_PATH=' + $ConfigPath)
Write-Output 'ARIA_WORKER_TOKEN_VALUE=NOT_DISPLAYED'
