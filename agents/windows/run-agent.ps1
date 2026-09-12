$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$ConfigDir = Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent'
$ConfigPath = Join-Path $ConfigDir 'config.json'
$TokenPath = Join-Path $ConfigDir 'device-token.dpapi'
$AgentPath = Join-Path $AgentRoot 'aria-agent.js'
$StagingDir = Join-Path $env:ProgramData 'ARIA-Windows-Agent'
$StagingTokenPath = Join-Path $StagingDir 'token.staging'

function Write-Log([string]$Message) {
    Write-Output "[ARIA-WATCHDOG] $(Get-Date -Format o) $Message"
}

if (-not (Test-Path $ConfigPath)) { throw "ARIA config not found: $ConfigPath" }
if (-not (Test-Path $AgentPath)) { throw "ARIA agent not found: $AgentPath" }

if (Test-Path $StagingTokenPath) {
    New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
    $stagedToken = (Get-Content -Raw -Path $StagingTokenPath).Trim()
    if ([string]::IsNullOrWhiteSpace($stagedToken) -or $stagedToken.Length -lt 32) {
        throw 'ARIA staged token is missing or invalid'
    }
    $secureStaged = ConvertTo-SecureString -String $stagedToken -AsPlainText -Force
    $encryptedStaged = $secureStaged | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encryptedStaged -Encoding ASCII
    Remove-Item -Path $StagingTokenPath -Force
    Write-Log 'TOKEN_STORE_REPAIRED_FROM_STAGING=True'
}

if (-not (Test-Path $TokenPath)) { throw "ARIA token store not found: $TokenPath" }

$config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
$encrypted = (Get-Content -Raw -Path $TokenPath).Trim()
if ([string]::IsNullOrWhiteSpace($encrypted)) { throw 'ARIA token store is empty' }
$secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$env:ARIA_DEVICE_ID = [string]$config.device_id
$env:ARIA_DEVICE_TOKEN = $token
$env:ARIA_DEVICE_GATEWAY_URL = [string]$config.gateway_url
if ($config.heartbeat_ms) { $env:ARIA_HEARTBEAT_MS = [string]$config.heartbeat_ms }
if ($config.poll_ms) { $env:ARIA_POLL_MS = [string]$config.poll_ms }
if ($config.gateway_timeout_ms) { $env:ARIA_GATEWAY_TIMEOUT_MS = [string]$config.gateway_timeout_ms }
if ($config.gateway_retries) { $env:ARIA_GATEWAY_RETRIES = [string]$config.gateway_retries }

$node = [string]$config.node_path
if (-not (Test-Path $node)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'Node.js not found' }
    $node = $nodeCommand.Source
}

Write-Log "START device=$($env:ARIA_DEVICE_ID) node=$node"

while ($true) {
    $process = Start-Process -FilePath $node -ArgumentList @($AgentPath) -WorkingDirectory $RepoRoot -PassThru -NoNewWindow
    Write-Log "AGENT_STARTED pid=$($process.Id)"
    $process.WaitForExit()
    Write-Log "AGENT_EXIT code=$($process.ExitCode) restarting_in_ms=5000"
    Start-Sleep -Seconds 5
}
