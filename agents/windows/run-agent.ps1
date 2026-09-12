$ErrorActionPreference = 'Stop'

$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$AgentRoot = Join-Path $RuntimeRoot 'Runtime\windows'
$RepoRoot = $AgentRoot
$ConfigDir = Join-Path $RuntimeRoot 'Data'
$ConfigPath = Join-Path $ConfigDir 'config.json'
$TokenPath = Join-Path $ConfigDir 'device-token.dpapi'
$AgentPath = Join-Path $AgentRoot 'aria-agent.js'
$PublicDir = Join-Path $RuntimeRoot 'Logs'
$StagingTokenPath = Join-Path $ConfigDir 'token.staging'
$LogPath = Join-Path $PublicDir 'watchdog.log'
$PidPath = Join-Path $PublicDir 'agent.pid'
$StatusPath = Join-Path $PublicDir 'status.json'
$WatchdogPidPath = Join-Path $PublicDir 'watchdog.pid'
$KillRequestPath = Join-Path $PublicDir 'kill-request'

New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

function Write-Log([string]$Message) {
    $line = "[ARIA-WATCHDOG] $(Get-Date -Format o) $Message"
    try { Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
    Write-Output $line
}

function Write-Status([hashtable]$Fields) {
    try {
        $payload = [ordered]@{
            updated_at = (Get-Date -Format o)
            watchdog_pid = $PID
            agent_path = $AgentPath
            runtime_root = $RuntimeRoot
        }
        foreach ($key in $Fields.Keys) { $payload[$key] = $Fields[$key] }
        ($payload | ConvertTo-Json -Compress) | Set-Content -Path $StatusPath -Encoding UTF8 -Force
    } catch {}
}

function Resolve-Token {
    if (Test-Path $StagingTokenPath) {
        $stagedToken = (Get-Content -Raw -Path $StagingTokenPath).Trim()
        if ([string]::IsNullOrWhiteSpace($stagedToken) or $stagedToken.Length -lt 32) {
            throw 'ARIA staged token is missing or invalid'
        }
        $secureStaged = ConvertTo-SecureString -String $stagedToken -AsPlainText -Force
        $encryptedStaged = $secureStaged | ConvertFrom-SecureString
        Set-Content -Path $TokenPath -Value $encryptedStaged -Encoding ASCII
        Remove-Item -Path $StagingTokenPath -Force -ErrorAction SilentlyContinue
        Write-Log 'TOKEN_STORE_REPAIRED_FROM_STAGING=True'
    }
    if (-not (Test-Path $TokenPath)) { throw "ARIA token store not found: $TokenPath" }
    $encrypted = (Get-Content -Raw -Path $TokenPath).Trim()
    if ([string]::IsNullOrWhiteSpace($encrypted)) { throw 'ARIA token store is empty' }
    $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

try { Set-Content -Path $WatchdogPidPath -Value $PID -Encoding ASCII -Force } catch {}
Write-Log "WATCHDOG_START agentRoot=$AgentRoot publicDir=$PublicDir pid=$PID"
Write-Status @{ state = 'watchdog_alive'; agent_pid = $null }

$consecutiveErrors = 0
$maxConsecutiveErrors = 6

while ($true) {
    try {
        if (-not (Test-Path $ConfigPath)) { throw "ARIA config not found: $ConfigPath" }
        if (-not (Test-Path $AgentPath)) { throw "ARIA agent not found: $AgentPath" }

        $config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
        $token = Resolve-Token

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
        # ONLY WindowStyle Hidden - never combine with -NoNewWindow (PowerShell throws).
        $process = Start-Process -FilePath $node -ArgumentList @($AgentPath) -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden
        Write-Log "AGENT_STARTED pid=$($process.Id)"
        $consecutiveErrors = 0
        try { Set-Content -Path $PidPath -Value $process.Id -Encoding ASCII -Force } catch {}
        Write-Status @{
            state = 'agent_running'
            agent_pid = $process.Id
            node_path = $node
            started_at = (Get-Date -Format o)
        }

        # Wait for exit OR public kill-request (so NetworkService preflight can signal without process rights).
        while (-not $process.HasExited) {
            if (Test-Path $KillRequestPath) {
                $req = ''
                try { $req = (Get-Content -Raw $KillRequestPath).Trim() } catch {}
                Write-Log "KILL_REQUEST_SEEN payload=$req agent_pid=$($process.Id)"
                try { Remove-Item -Path $KillRequestPath -Force -ErrorAction SilentlyContinue } catch {}
                try {
                    Stop-Process -Id $process.Id -Force -ErrorAction Stop
                    Write-Log "AGENT_KILLED_BY_WATCHDOG pid=$($process.Id)"
                } catch {
                    Write-Log "AGENT_KILL_FAILED $($_.Exception.Message)"
                }
                break
            }
            Start-Sleep -Milliseconds 500
            try { $process.Refresh() } catch { break }
        }

        if (-not $process.HasExited) {
            try { $process.WaitForExit(5000) | Out-Null } catch {}
        }
        $code = $process.ExitCode
        Write-Log "AGENT_EXIT code=$code restarting_in_ms=5000"
        try { Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue } catch {}
        Write-Status @{ state = 'agent_restarting'; agent_pid = $null; last_exit_code = $code }
        Start-Sleep -Seconds 5
    }
    catch {
        $consecutiveErrors++
        Write-Log "WATCHDOG_ERROR count=$consecutiveErrors $($_.Exception.Message)"
        Write-Status @{ state = 'watchdog_error'; error = $_.Exception.Message; agent_pid = $null; consecutive_errors = $consecutiveErrors }
        if ($consecutiveErrors -ge $maxConsecutiveErrors) {
            Write-Log "WATCHDOG_EXIT after $consecutiveErrors consecutive errors (RestartOnFailure will reload script from disk)"
            Write-Status @{ state = 'watchdog_exiting'; consecutive_errors = $consecutiveErrors }
            exit 1
        }
        Start-Sleep -Seconds 10
    }
}
