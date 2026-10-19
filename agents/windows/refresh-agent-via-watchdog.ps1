$ErrorActionPreference = 'Continue'

$logDir = 'D:\ARIA-Windows-Agent\Logs'
$runtimeDir = 'D:\ARIA-Windows-Agent\Runtime\windows'
$dataDir = 'D:\ARIA-Windows-Agent\Data'
$statusPath = Join-Path $logDir 'status.json'
$watchdogPidPath = Join-Path $logDir 'watchdog.pid'
$agentPidPath = Join-Path $logDir 'agent.pid'
$requestPath = Join-Path $logDir 'kill-request.json'
$watchdogLogPath = Join-Path $logDir 'watchdog.log'
$runtimeShaPath = Join-Path $logDir 'runtime-source-sha'
$startupAuthorityPath = Join-Path $logDir 'startup-authority.json'
$watchdogScript = Join-Path $runtimeDir 'run-agent.ps1'
$configPath = Join-Path $dataDir 'config.json'
$tokenPath = Join-Path $dataDir 'device-token.dpapi'
$watchdogMutexName = 'Global\ARIA-Windows-Agent-Watchdog-v1'
$sourceSha = [string]$env:ARIA_EXPECTED_SHA

function Read-Status {
    try {
        if (Test-Path $statusPath) {
            $raw = Get-Content -Raw -Path $statusPath -ErrorAction Stop
            if ($raw -and $raw.Trim()) { return ($raw | ConvertFrom-Json) }
        }
    } catch {}
    return $null
}

function Test-ProcessExists {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return $false }
    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Read-WatchdogPid {
    try {
        if (Test-Path $watchdogPidPath) {
            $raw = (Get-Content -Raw -Path $watchdogPidPath).Trim()
            if ($raw) { return [int]$raw }
        }
    } catch {}
    return 0
}

function Test-CanDecryptToken {
    if (-not (Test-Path $tokenPath)) { return $false }
    try {
        $encrypted = (Get-Content -Raw $tokenPath).Trim()
        $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        return $true
    } catch {
        return $false
    }
}

function Test-WatchdogMutexHeld {
    $result = [pscustomobject]@{
        Held = $false
        Accessible = $false
        State = 'unknown'
    }
    $mutex = $null
    try {
        $mutex = [System.Threading.Mutex]::OpenExisting($watchdogMutexName)
        $result.Accessible = $true
        try {
            if ($mutex.WaitOne(0)) {
                $mutex.ReleaseMutex()
                $result.State = 'free'
                return $result
            }
            $result.Held = $true
            $result.State = 'held'
            return $result
        } catch [System.Threading.AbandonedMutexException] {
            $result.Held = $true
            $result.State = 'abandoned-owner-recovered'
            return $result
        }
    } catch [System.Threading.WaitHandleCannotBeOpenedException] {
        $result.Accessible = $true
        $result.State = 'missing'
        return $result
    } catch [System.UnauthorizedAccessException] {
        $result.State = 'access_denied'
        return $result
    } catch {
        $result.State = 'error:' + $_.Exception.GetType().Name
        return $result
    } finally {
        if ($mutex) {
            try { $mutex.Dispose() } catch {}
        }
    }
}

function Get-LiveWatchdogProcesses {
    $list = @()
    try {
        $wps = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -like '*run-agent.ps1*'
        }
        foreach ($w in @($wps)) {
            $owner = ''
            try {
                $o = Invoke-CimMethod -InputObject $w -MethodName GetOwner
                if ($o) { $owner = if ($o.Domain) { "$($o.Domain)\$($o.User)" } else { [string]$o.User } }
            } catch {}
            $list += [pscustomobject]@{
                Pid = [int]$w.ProcessId
                Owner = $owner
                SessionId = [int]$w.SessionId
                CommandLine = [string]$w.CommandLine
            }
        }
    } catch {}
    return $list
}

function Write-KillRequest {
    param([string]$Reason, [string]$Sha)
    $payload = (@{
        reason = $Reason
        source_sha = $Sha
        requested_at = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($requestPath, $payload, $utf8)
    Write-Host ("WATCHDOG_REFRESH_REQUEST=json source_sha=" + $Sha)
}

function Show-Diagnostics {
    param([string]$Label)
    Write-Host ("--- DIAG " + $Label + " ---")
    Write-Host ("DIAG_USER=" + [Environment]::UserName)
    Write-Host ("DIAG_TOKEN_DECRYPTABLE=" + (Test-CanDecryptToken))
    Write-Host ("DIAG_SOURCE_SHA=" + $sourceSha)
    Write-Host ("DIAG_CONFIG_EXISTS=" + (Test-Path $configPath))
    Write-Host ("DIAG_TOKEN_EXISTS=" + (Test-Path $tokenPath))
    Write-Host ("DIAG_AGENT_EXISTS=" + (Test-Path (Join-Path $runtimeDir 'aria-agent.js')))
    Write-Host ("DIAG_WATCHDOG_SCRIPT_EXISTS=" + (Test-Path $watchdogScript))
    $mutexDiag = Test-WatchdogMutexHeld
    Write-Host ("DIAG_WATCHDOG_MUTEX=" + $mutexDiag.State)
    Write-Host ("DIAG_WATCHDOG_MUTEX_ACCESSIBLE=" + $mutexDiag.Accessible)
    Write-Host ("DIAG_WATCHDOG_MUTEX_HELD=" + $mutexDiag.Held)
    if (Test-Path $runtimeShaPath) {
        Write-Host ("DIAG_RUNTIME_SHA=" + ((Get-Content -Raw $runtimeShaPath).Trim()))
    }
    if (Test-Path $startupAuthorityPath) {
        try {
            $auth = Get-Content -Raw $startupAuthorityPath | ConvertFrom-Json
            Write-Host ("DIAG_STARTUP_AUTHORITY=" + $auth.authority)
        } catch {
            Write-Host 'DIAG_STARTUP_AUTHORITY=parse_failed'
        }
    } else {
        Write-Host 'DIAG_STARTUP_AUTHORITY=missing'
    }
    if (Test-Path $configPath) {
        try {
            $cfg = Get-Content -Raw $configPath | ConvertFrom-Json
            Write-Host ("DIAG_DEVICE=" + $cfg.device_id)
            Write-Host ("DIAG_NODE_PATH=" + $cfg.node_path)
            Write-Host ("DIAG_NODE_EXISTS=" + (Test-Path ([string]$cfg.node_path)))
            if ($cfg.startup_authority) { Write-Host ("DIAG_CONFIG_STARTUP_AUTHORITY=" + $cfg.startup_authority) }
        } catch {
            Write-Host ("DIAG_CONFIG_PARSE_FAILED=" + $_.Exception.Message)
        }
    }
    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
        Write-Host ("DIAG_LOGGED_ON=" + $cs.UserName)
    } catch {}
    if (Test-Path $tokenPath) {
        try {
            $encrypted = (Get-Content -Raw $tokenPath).Trim()
            $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
            Write-Host 'DIAG_TOKEN_DECRYPT=PASS'
        } catch {
            Write-Host ("DIAG_TOKEN_DECRYPT=FAIL " + $_.Exception.Message)
        }
    }
    try {
        $statusRaw = if (Test-Path $statusPath) { Get-Content -Raw $statusPath } else { '' }
        Write-Host ("DIAG_STATUS=" + $statusRaw)
    } catch {
        Write-Host ("DIAG_STATUS_READ_FAILED=" + $_.Exception.Message)
    }
    Write-Host ("DIAG_WATCHDOG_PID_FILE=" + (Read-WatchdogPid))
    if (Test-Path $agentPidPath) {
        Write-Host ("DIAG_AGENT_PID_FILE=" + ((Get-Content -Raw $agentPidPath).Trim()))
    }
    $liveWd = Get-LiveWatchdogProcesses
    Write-Host ("DIAG_LIVE_WATCHDOG_COUNT=" + @($liveWd).Count)
    foreach ($w in @($liveWd)) {
        Write-Host ("DIAG_LIVE_WATCHDOG pid=" + $w.Pid + " owner=" + $w.Owner + " session=" + $w.SessionId)
    }
    try {
        $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -like '*aria-agent.js*'
        }
        Write-Host ("DIAG_ARIA_NODE_COUNT=" + @($nodes).Count)
        foreach ($n in @($nodes)) {
            $owner = ''
            try {
                $o = Invoke-CimMethod -InputObject $n -MethodName GetOwner
                if ($o) { $owner = if ($o.Domain) { "$($o.Domain)\$($o.User)" } else { [string]$o.User } }
            } catch {}
            Write-Host ("DIAG_ARIA_NODE pid=" + $n.ProcessId + " owner=" + $owner + " session=" + $n.SessionId)
        }
    } catch {
        Write-Host ("DIAG_ARIA_NODE_SCAN_FAILED=" + $_.Exception.Message)
    }
    if (Test-Path $watchdogLogPath) {
        Write-Host '--- watchdog.log tail ---'
        Get-Content -Path $watchdogLogPath -Tail 30 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host 'DIAG_WATCHDOG_LOG=missing'
    }
    Write-Host ("--- END DIAG " + $Label + " ---")
}

function Wait-AgentRefresh {
    param([string]$BeforePid, [int]$TimeoutSeconds, [string]$PassLabel)
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        Start-Sleep -Seconds 1
        $s = Read-Status
        if ($s -and [string]$s.state -eq 'agent_running' -and -not [string]::IsNullOrWhiteSpace([string]$s.agent_pid) -and [string]$s.agent_pid -ne $BeforePid) {
            Write-Host ($PassLabel + " old=" + $BeforePid + " new=" + $s.agent_pid)
            return $true
        }
        if (($i % 15) -eq 14 -and $s) {
            Write-Host ("REFRESH_WAIT t=" + ($i + 1) + "s state=" + $s.state + " agent_pid=" + $s.agent_pid + " consecutive=" + $s.consecutive_errors + " last_error=" + $s.last_error + $s.error)
        }
    }
    return $false
}

if ([string]::IsNullOrWhiteSpace($sourceSha)) { throw 'ARIA_EXPECTED_SHA missing' }

Show-Diagnostics -Label 'BEFORE'

$s = Read-Status
$before = if ($s) { [string]$s.agent_pid } else { '' }
$watchdogPid = Read-WatchdogPid
$ownerAlive = ($watchdogPid -gt 0 -and (Test-ProcessExists -ProcessId $watchdogPid))
$liveWd = Get-LiveWatchdogProcesses
$interactiveOwnerAlive = $false
foreach ($w in @($liveWd)) {
    if ($w.SessionId -gt 0 -and $w.Owner -and ($w.Owner -match 'robvg')) {
        $interactiveOwnerAlive = $true
        Write-Host ("INTERACTIVE_WATCHDOG_FOUND pid=" + $w.Pid + " owner=" + $w.Owner + " session=" + $w.SessionId)
        if (-not $ownerAlive) { $watchdogPid = $w.Pid; $ownerAlive = $true }
    }
}

$mutexDiag = Test-WatchdogMutexHeld
if ($mutexDiag.Held) {
    $interactiveOwnerAlive = $true
    Write-Host ("INTERACTIVE_WATCHDOG_MUTEX_FOUND state=" + $mutexDiag.State)
}

if (-not $ownerAlive -and -not $interactiveOwnerAlive) {
    Write-Host 'WATCHDOG_OWNER=absent'
    Write-Host 'WATCHDOG_BOOTSTRAP=SKIPPED reason=SYSTEM_cannot_create_interactive_owner'
    Write-Host 'WATCHDOG_REQUIRES_USER_RUN_SINGLETON'
    Write-Host 'EXPECTED: HKCU Run ARIA-Windows-Local-Agent -> run-agent.ps1 under ROBVG\robvg'
    Show-Diagnostics -Label 'FINAL'
    throw 'No interactive Watchdog owner. SYSTEM cannot bootstrap. Start run-agent.ps1 once as ROBVG\robvg (user_run_singleton).'
}

if ($ownerAlive) {
    Write-Host ("WATCHDOG_ALREADY_RUNNING_PID=" + $watchdogPid)
} elseif ($mutexDiag.Held) {
    Write-Host 'WATCHDOG_ALREADY_RUNNING_MUTEX=held'
}
Write-KillRequest -Reason 'certification-source-refresh' -Sha $sourceSha
$refreshed = Wait-AgentRefresh -BeforePid $before -TimeoutSeconds 90 -PassLabel 'AGENT_REFRESHED=PASS'

if (-not $refreshed) {
    Write-Host 'AGENT_REFRESH_TIMEOUT interactive owner did not recover Agent'
    Show-Diagnostics -Label 'FINAL'
    throw 'Interactive Watchdog did not recover Agent after kill-request'
}

Show-Diagnostics -Label 'AFTER_PASS'
Write-Host 'WATCHDOG_REFRESH=PASS'
exit 0
