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
$WatchdogPidPath = Join-Path $PublicDir 'watchdog.pid'
$KillRequestPath = Join-Path $PublicDir 'kill-request.json'
$RuntimeSourceShaPath = Join-Path $PublicDir 'runtime-source-sha'
$MeditationStatePath = Join-Path $RuntimeRoot 'Runtime\meditation\state.json'
$AgentStdoutLatest = Join-Path $PublicDir 'agent-stdout.log'
$AgentStderrLatest = Join-Path $PublicDir 'agent-stderr.log'

New-Item -ItemType Directory -Force -Path $PublicDir | Out-Null
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

function Write-Log([string]$Message) {
    $line = "[ARIA-WATCHDOG] $(Get-Date -Format o) $Message"
    try { Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
    Write-Output $line
}

function Write-Status([hashtable]$Fields) {
    try {
        $payload = [ordered]@{ updated_at = (Get-Date -Format o); watchdog_pid = $PID; agent_path = $AgentPath; runtime_root = $RuntimeRoot }
        foreach ($key in $Fields.Keys) { $payload[$key] = $Fields[$key] }
        ($payload | ConvertTo-Json -Compress) | Set-Content -Path $StatusPath -Encoding UTF8 -Force
    } catch {}
}

function Resolve-Token {
    if (Test-Path $StagingTokenPath) {
        $stagedToken = (Get-Content -Raw -Path $StagingTokenPath).Trim()
        if ([string]::IsNullOrWhiteSpace($stagedToken) -or $stagedToken.Length -lt 32) { throw 'ARIA staged token is missing or invalid' }
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

function Read-RuntimeSourceSha {
    try { if (Test-Path $RuntimeSourceShaPath) { return (Get-Content -Raw -Path $RuntimeSourceShaPath).Trim() } } catch {}
    return ''
}

function Wait-AgentExit([int]$AgentProcessId, [int]$TimeoutSeconds = 20) {
    if ($AgentProcessId -le 0) { return $true }
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        try { Get-Process -Id $AgentProcessId -ErrorAction Stop | Out-Null } catch { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Wait-StateFileRelease([int]$TimeoutSeconds = 20) {
    if (-not (Test-Path $MeditationStatePath)) { return $true }
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        $stream = $null
        try {
            $stream = [System.IO.File]::Open($MeditationStatePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            $stream.Close()
            return $true
        } catch {
            try { if ($null -ne $stream) { $stream.Close() } } catch {}
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Get-StaleAgentPids {
    $ids = @()
    try {
        $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue
        foreach ($candidate in @($candidates)) {
            try {
                if ($candidate.ProcessId -ne $PID -and $candidate.CommandLine -and $candidate.CommandLine -like "*$AgentPath*") {
                    $ids += [int]$candidate.ProcessId
                }
            } catch {}
        }
    } catch {
        Write-Log "STALE_AGENT_SCAN_FAILED $($_.Exception.Message)"
    }
    return $ids
}

function Write-AgentStreamTail([string]$Label, [string]$Path) {
    try {
        if (-not (Test-Path $Path)) {
            Write-Log ("AGENT_STREAM " + $Label + "=missing path=" + $Path)
            return
        }
        $len = (Get-Item $Path -ErrorAction SilentlyContinue).Length
        Write-Log ("AGENT_STREAM " + $Label + " path=" + $Path + " bytes=" + $len)
        if ($len -gt 0) {
            $tail = Get-Content -Path $Path -Tail 80 -ErrorAction SilentlyContinue
            foreach ($line in @($tail)) {
                Write-Log ("AGENT_" + $Label + "| " + $line)
            }
        }
    } catch {
        Write-Log ("AGENT_STREAM_TAIL_FAILED " + $Label + " " + $_.Exception.Message)
    }
}

try { Set-Content -Path $WatchdogPidPath -Value $PID -Encoding ASCII -Force } catch {}
Write-Log "WATCHDOG_START agentRoot=$AgentRoot publicDir=$PublicDir pid=$PID mutex=ARIA-Windows-Agent-Watchdog-v1"
Write-Status @{ state = 'watchdog_alive'; agent_pid = $null; runtime_source_sha = (Read-RuntimeSourceSha) }

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
            if (-not $nodeCommand) { throw "Node.js not found at config.path=$node" }
            $node = $nodeCommand.Source
        }

        Write-Log "START device=$($env:ARIA_DEVICE_ID) node=$node"

        foreach ($stalePid in (Get-StaleAgentPids)) {
            try {
                Stop-Process -Id $stalePid -Force -ErrorAction Stop
                Write-Log "STALE_AGENT_KILLED pid=$stalePid"
            } catch {
                Write-Log "STALE_AGENT_KILL_FAILED pid=$stalePid $($_.Exception.Message)"
            }
            [void](Wait-AgentExit -AgentProcessId $stalePid -TimeoutSeconds 20)
            [void](Wait-StateFileRelease -TimeoutSeconds 20)
        }

        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $stdoutPath = Join-Path $PublicDir ("agent-stdout-" + $stamp + ".log")
        $stderrPath = Join-Path $PublicDir ("agent-stderr-" + $stamp + ".log")
        try {
            if (Test-Path $AgentStdoutLatest) { Remove-Item $AgentStdoutLatest -Force -ErrorAction SilentlyContinue }
            if (Test-Path $AgentStderrLatest) { Remove-Item $AgentStderrLatest -Force -ErrorAction SilentlyContinue }
        } catch {}

        $process = $null
        try {
            $process = Start-Process -FilePath $node -ArgumentList @($AgentPath) -WorkingDirectory $RepoRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        } catch {
            throw "AGENT_START_FAILED node=$node agent=$AgentPath $($_.Exception.Message)"
        }
        if (-not $process -or -not $process.Id) { throw "AGENT_START_FAILED no_pid node=$node" }

        # Rename to PID-tagged files once PID is known; keep stable latest aliases
        $stdoutPidPath = Join-Path $PublicDir ("agent-stdout-pid" + $process.Id + ".log")
        $stderrPidPath = Join-Path $PublicDir ("agent-stderr-pid" + $process.Id + ".log")
        try {
            if (Test-Path $stdoutPath) { Move-Item -Path $stdoutPath -Destination $stdoutPidPath -Force -ErrorAction SilentlyContinue }
            if (Test-Path $stderrPath) { Move-Item -Path $stderrPath -Destination $stderrPidPath -Force -ErrorAction SilentlyContinue }
            if (Test-Path $stdoutPidPath) { Copy-Item $stdoutPidPath $AgentStdoutLatest -Force -ErrorAction SilentlyContinue }
            if (Test-Path $stderrPidPath) { Copy-Item $stderrPidPath $AgentStderrLatest -Force -ErrorAction SilentlyContinue }
        } catch {}
        if (-not (Test-Path $stdoutPidPath)) { $stdoutPidPath = $stdoutPath }
        if (-not (Test-Path $stderrPidPath)) { $stderrPidPath = $stderrPath }

        Write-Log ("AGENT_STARTED pid=" + $process.Id + " stdout=" + $stdoutPidPath + " stderr=" + $stderrPidPath)
        $consecutiveErrors = 0
        try { Set-Content -Path $PidPath -Value $process.Id -Encoding ASCII -Force } catch {}
        Write-Status @{ state = 'agent_running'; agent_pid = $process.Id; node_path = $node; started_at = (Get-Date -Format o); runtime_source_sha = (Read-RuntimeSourceSha); stdout_log = $stdoutPidPath; stderr_log = $stderrPidPath }

        while (-not $process.HasExited) {
            if (Test-Path $KillRequestPath) {
                $req = $null
                try { $req = Get-Content -Raw -Path $KillRequestPath | ConvertFrom-Json } catch {}
                try { Remove-Item -Path $KillRequestPath -Force -ErrorAction SilentlyContinue } catch {}
                $requestedSha = [string]$req.source_sha
                $runtimeSha = Read-RuntimeSourceSha
                if ([string]::IsNullOrWhiteSpace($requestedSha)) { Write-Log "KILL_REQUEST_IGNORED reason=missing_source_sha agent_pid=$($process.Id)"; continue }
                if ([string]::IsNullOrWhiteSpace($runtimeSha) -or $requestedSha -ne $runtimeSha) { Write-Log "KILL_REQUEST_IGNORED reason=stale_source requested_sha=$requestedSha runtime_sha=$runtimeSha agent_pid=$($process.Id)"; continue }
                Write-Log "KILL_REQUEST_ACCEPTED payload=$([string]$req.reason) source_sha=$requestedSha agent_pid=$($process.Id)"
                try { Stop-Process -Id $process.Id -Force -ErrorAction Stop; Write-Log "AGENT_KILLED_BY_WATCHDOG pid=$($process.Id)" } catch { Write-Log "AGENT_KILL_FAILED $($_.Exception.Message)" }
                [void](Wait-AgentExit -AgentProcessId ([int]$process.Id) -TimeoutSeconds 20)
                [void](Wait-StateFileRelease -TimeoutSeconds 20)
                break
            }
            Start-Sleep -Milliseconds 500
            try { $process.Refresh() } catch { break }
        }

        if (-not $process.HasExited) { try { $process.WaitForExit(5000) | Out-Null } catch {} }
        $code = $process.ExitCode
        Write-Log "AGENT_EXIT code=$code restarting_in_ms=5000"
        try {
            if (Test-Path $stdoutPidPath) { Copy-Item $stdoutPidPath $AgentStdoutLatest -Force -ErrorAction SilentlyContinue }
            if (Test-Path $stderrPidPath) { Copy-Item $stderrPidPath $AgentStderrLatest -Force -ErrorAction SilentlyContinue }
        } catch {}
        Write-AgentStreamTail -Label 'STDOUT' -Path $stdoutPidPath
        Write-AgentStreamTail -Label 'STDERR' -Path $stderrPidPath
        try { Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue } catch {}
        Write-Status @{ state = 'agent_restarting'; agent_pid = $null; last_exit_code = $code; runtime_source_sha = (Read-RuntimeSourceSha); stdout_log = $stdoutPidPath; stderr_log = $stderrPidPath }
        Start-Sleep -Seconds 5
    }
    catch {
        $consecutiveErrors++
        $err = $_.Exception.Message
        Write-Log "WATCHDOG_ERROR count=$consecutiveErrors $err"
        Write-Status @{ state = 'watchdog_error'; error = $err; last_error = $err; agent_pid = $null; consecutive_errors = $consecutiveErrors; runtime_source_sha = (Read-RuntimeSourceSha) }
        if ($consecutiveErrors -ge $maxConsecutiveErrors) {
            Write-Log "WATCHDOG_EXIT after $consecutiveErrors consecutive errors last_error=$err"
            Write-Status @{ state = 'watchdog_exiting'; consecutive_errors = $consecutiveErrors; last_error = $err; error = $err; runtime_source_sha = (Read-RuntimeSourceSha) }
            exit 1
        }
        Start-Sleep -Seconds 10
    }
}
