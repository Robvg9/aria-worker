$ErrorActionPreference = 'Stop'

$mutexCreated = $false
$watchdogMutex = New-Object System.Threading.Mutex($false, 'Global\ARIA-Windows-Agent-Watchdog-v1', [ref]$mutexCreated)
if (-not $mutexCreated) {
    Write-Output '[ARIA-WATCHDOG] EXISTING_INSTANCE=True exiting_duplicate_watchdog'
    exit 0
}

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
$HeartbeatPath = Join-Path $PublicDir 'agent-heartbeat.json'
$AgentHeartbeatStaleSeconds = 120
$AgentStartupGraceSeconds = 45
$WatchdogPidPath = Join-Path $PublicDir 'watchdog.pid'
$KillRequestPath = Join-Path $PublicDir 'kill-request'
$DesktopTestRequestPath = Join-Path $PublicDir 'desktop-101-request.json'
$DesktopTestResultPath = Join-Path $PublicDir 'desktop-101-result.json'
$DesktopCommanderSupervisorPath = Join-Path $AgentRoot 'desktop-commander-supervisor.ps1'
$DesktopCommanderSupervisorPidPath = Join-Path $PublicDir 'desktop-commander-supervisor.pid'
$DesktopCommanderCheckSeconds = 10


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


function Find-DesktopCommanderSupervisor {
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction Stop
        foreach ($proc in $procs) {
            $cmd = [string]$proc.CommandLine
            if ($cmd.IndexOf('desktop-commander-supervisor.ps1',[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                return [int]$proc.ProcessId
            }
        }
    } catch {
        Write-Log "DC_SUPERVISOR_SCAN_ERROR $($_.Exception.Message)"
    }
    return 0
}

function Test-DesktopCommanderSupervisorPid([int]$CandidatePid) {
    if ($CandidatePid -le 0) { return 0 }
    try {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$CandidatePid" -ErrorAction Stop
        if (-not $proc) { return 0 }
        $cmd = [string]$proc.CommandLine
        if ($cmd.IndexOf('desktop-commander-supervisor.ps1',[System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return $CandidatePid }
    } catch {}
    return 0
}

function Ensure-DesktopCommanderSupervisor {
    if (-not (Test-Path $DesktopCommanderSupervisorPath)) {
        Write-Log "DC_SUPERVISOR_MISSING path=$DesktopCommanderSupervisorPath"
        return
    }

    # PID file is the primary single-flight guard. Process scan is a fallback only.
    if (Test-Path $DesktopCommanderSupervisorPidPath) {
        try {
            $filePid = [int](Get-Content -Raw -Path $DesktopCommanderSupervisorPidPath).Trim()
            $livePid = Test-DesktopCommanderSupervisorPid $filePid
            if ($livePid -gt 0) { return }
        } catch {}
        Remove-Item -Path $DesktopCommanderSupervisorPidPath -Force -ErrorAction SilentlyContinue
    }

    $existingPid = Find-DesktopCommanderSupervisor
    if ($existingPid -gt 0) {
        try { Set-Content -Path $DesktopCommanderSupervisorPidPath -Value $existingPid -Encoding ASCII -Force } catch {}
        return
    }

    # Final short race guard: re-check immediately before spawning.
    $existingPid = Find-DesktopCommanderSupervisor
    if ($existingPid -gt 0) {
        try { Set-Content -Path $DesktopCommanderSupervisorPidPath -Value $existingPid -Encoding ASCII -Force } catch {}
        return
    }

    try {
        $child = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-WindowStyle', 'Hidden',
            '-File', $DesktopCommanderSupervisorPath
        ) -WorkingDirectory $AgentRoot -PassThru -WindowStyle Hidden

        Set-Content -Path $DesktopCommanderSupervisorPidPath -Value $child.Id -Encoding ASCII -Force
        Write-Log "DC_SUPERVISOR_STARTED pid=$($child.Id)"
    } catch {
        Write-Log "DC_SUPERVISOR_START_FAILED $($_.Exception.Message)"
    }
}

function Protect-MachineToken([string]$Token) {
    Add-Type -AssemblyName System.Security
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Token)
    $protected = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return 'ARIA-DPAPI-MACHINE-V1:' + [Convert]::ToBase64String($protected)
}

function Unprotect-MachineToken([string]$Payload) {
    Add-Type -AssemblyName System.Security
    $encoded = $Payload.Substring('ARIA-DPAPI-MACHINE-V1:'.Length)
    if ([string]::IsNullOrWhiteSpace($encoded)) { throw 'ARIA machine token payload is empty' }
    $protected = [Convert]::FromBase64String($encoded)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $protected,
        $null,
        [System.Security.Cryptography.DataProtectionScope]::LocalMachine
    )
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Resolve-Token {
    if (Test-Path $StagingTokenPath) {
        $stagedToken = (Get-Content -Raw -Path $StagingTokenPath).Trim()
        if ([string]::IsNullOrWhiteSpace($stagedToken) -or $stagedToken.Length -lt 32) {
            throw 'ARIA staged token is missing or invalid'
        }
        $machinePayload = Protect-MachineToken $stagedToken
        Set-Content -Path $TokenPath -Value $machinePayload -Encoding ASCII -Force
        Remove-Item -Path $StagingTokenPath -Force -ErrorAction SilentlyContinue
        Write-Log 'TOKEN_STORE_REPAIRED_FROM_STAGING=True scope=LocalMachine'
    }
    if (-not (Test-Path $TokenPath)) { throw "ARIA token store not found: $TokenPath" }
    $encrypted = (Get-Content -Raw -Path $TokenPath).Trim()
    if ([string]::IsNullOrWhiteSpace($encrypted)) { throw 'ARIA token store is empty' }

    if ($encrypted.StartsWith('ARIA-DPAPI-MACHINE-V1:')) {
        return Unprotect-MachineToken $encrypted
    }

    # Backward compatibility for token stores created before the machine-scope format.
    $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

try { Set-Content -Path $WatchdogPidPath -Value $PID -Encoding ASCII -Force } catch {}
Write-Log "WATCHDOG_START agentRoot=$AgentRoot publicDir=$PublicDir pid=$PID mutex=ARIA-Windows-Agent-Watchdog-v1"
Write-Status @{ state = 'watchdog_alive'; agent_pid = $null }
Ensure-DesktopCommanderSupervisor
$lastDesktopCommanderCheck = Get-Date

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
        $env:ARIA_AGENT_HEARTBEAT_PATH = $HeartbeatPath
        $env:ARIA_DEVICE_GATEWAY_URL = [string]$config.gateway_url
        if (Test-Path $HeartbeatPath) { Remove-Item -Path $HeartbeatPath -Force -ErrorAction SilentlyContinue }
        if ($config.heartbeat_ms) { $env:ARIA_HEARTBEAT_MS = [string]$config.heartbeat_ms }
        if ($config.poll_ms) { $env:ARIA_POLL_MS = [string]$config.poll_ms }
        if ($config.gateway_timeout_ms) { $env:ARIA_GATEWAY_TIMEOUT_MS = [string]$config.gateway_timeout_ms }
        if ($config.gateway_retries) { $env:ARIA_GATEWAY_RETRIES = [string]$config.gateway_retries }
        $env:ARIA_OLLAMA_ENABLED = if ($config.ollama_enabled -eq $true) { 'true' } else { 'false' }

        $node = [string]$config.node_path
        if (-not (Test-Path $node)) {
            $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
            if (-not $nodeCommand) { throw 'Node.js not found' }
            $node = $nodeCommand.Source
        }

        $agentLogStamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $AgentStdoutPath = Join-Path $PublicDir "agent-stdout-$agentLogStamp.log"
        $AgentStderrPath = Join-Path $PublicDir "agent-stderr-$agentLogStamp.log"
        Write-Log "START device=$($env:ARIA_DEVICE_ID) node=$node"
        Write-Log "AGENT_LOGS stdout=$AgentStdoutPath stderr=$AgentStderrPath"
        $process = Start-Process -FilePath $node -ArgumentList @($AgentPath) -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $AgentStdoutPath -RedirectStandardError $AgentStderrPath
        Write-Log "AGENT_STARTED pid=$($process.Id)"
        $consecutiveErrors = 0
        try { Set-Content -Path $PidPath -Value $process.Id -Encoding ASCII -Force } catch {}
        Write-Status @{
            state = 'agent_running'
            agent_pid = $process.Id
            node_path = $node
            agent_stdout_log = $AgentStdoutPath
            agent_stderr_log = $AgentStderrPath
            started_at = (Get-Date -Format o)
        }

        $agentStartedAt = Get-Date
        while (-not $process.HasExited) {
            if (((Get-Date) - $lastDesktopCommanderCheck).TotalSeconds -ge $DesktopCommanderCheckSeconds) {
                Ensure-DesktopCommanderSupervisor
                $lastDesktopCommanderCheck = Get-Date
            }
            if ((Get-Date) -lt $agentStartedAt.AddSeconds($AgentStartupGraceSeconds)) { }
            elseif (-not (Test-Path $HeartbeatPath) -or ((Get-Date).ToUniversalTime() - (Get-Item $HeartbeatPath).LastWriteTimeUtc).TotalSeconds -gt $AgentHeartbeatStaleSeconds) {
                Write-Log "AGENT_STALE_HEARTBEAT action=restart threshold_seconds=$AgentHeartbeatStaleSeconds"
                try {
                    Stop-Process -Id $process.Id -Force -ErrorAction Stop
                    Write-Log "AGENT_KILLED_BY_WATCHDOG_STALE_HEARTBEAT pid=$($process.Id)"
                } catch {
                    Write-Log "AGENT_STALE_HEARTBEAT_KILL_FAILED $($_.Exception.Message)"
                }
                break
            }
            if (Test-Path $DesktopTestRequestPath) {
                try {
                    $request = Get-Content -Raw -Path $DesktopTestRequestPath | ConvertFrom-Json
                    Remove-Item -Path $DesktopTestRequestPath -Force -ErrorAction SilentlyContinue

                    $testNode = [string]$request.node
                    $testScript = [string]$request.script
                    $testWorkingDirectory = [string]$request.working_directory
                    $testLog = [string]$request.log
                    $testErrorLog = [string]$request.error_log

                    if ([string]::IsNullOrWhiteSpace($testNode)) { throw 'desktop-101 request node is missing' }
                    if ([string]::IsNullOrWhiteSpace($testScript)) { throw 'desktop-101 request script is missing' }
                    if ([string]::IsNullOrWhiteSpace($testWorkingDirectory)) { $testWorkingDirectory = $RepoRoot }
                    if ([string]::IsNullOrWhiteSpace($testLog)) { $testLog = Join-Path $PublicDir 'desktop-101-child.log' }
                    if ([string]::IsNullOrWhiteSpace($testErrorLog)) { $testErrorLog = Join-Path $PublicDir 'desktop-101-child.err' }

                    Write-Log "DESKTOP_101_REQUEST_START script=$testScript"
                    $child = Start-Process -FilePath $testNode -ArgumentList @($testScript) -WorkingDirectory $testWorkingDirectory -RedirectStandardOutput $testLog -RedirectStandardError $testErrorLog -PassThru -WindowStyle Hidden
                    $childSessionId = [int]$child.SessionId
                    $child.WaitForExit()
                    $exitCode = $child.ExitCode
                    Write-Log "DESKTOP_101_REQUEST_EXIT code=$exitCode session=$childSessionId"

                    $result = [ordered]@{
                        status = if ($exitCode -eq 0) { 'succeeded' } else { 'failed' }
                        exit_code = $exitCode
                        child_pid = $child.Id
                        child_session_id = $childSessionId
                        log = $testLog
                        error_log = $testErrorLog
                        completed_at = (Get-Date -Format o)
                    }
                    ($result | ConvertTo-Json -Depth 10) | Set-Content -Path $DesktopTestResultPath -Encoding UTF8 -Force
                }
                catch {
                    $err = [ordered]@{
                        status = 'failed'
                        exit_code = 1
                        error = $_.Exception.Message
                        completed_at = (Get-Date -Format o)
                    }
                    ($err | ConvertTo-Json -Depth 10) | Set-Content -Path $DesktopTestResultPath -Encoding UTF8 -Force
                    Write-Log "DESKTOP_101_REQUEST_ERROR $($_.Exception.Message)"
                }
            }

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

# RWHT preflight trigger: machine-scope token repair validation.
