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
$watchdogScript = Join-Path $runtimeDir 'run-agent.ps1'
$configPath = Join-Path $dataDir 'config.json'
$tokenPath = Join-Path $dataDir 'device-token.dpapi'
$sourceSha = [string]$env:ARIA_EXPECTED_SHA
$bootstrapTaskName = 'ARIA-Watchdog-User-Bootstrap'

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

function Get-InteractiveUserId {
    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
        if ($cs.UserName -and $cs.UserName.Trim()) {
            Write-Host "INTERACTIVE_USER_COMPUTER=$($cs.UserName)"
            return [string]$cs.UserName
        }
    } catch {
        Write-Host "INTERACTIVE_USER_COMPUTER_FAILED=$($_.Exception.Message)"
    }
    try {
        foreach ($ex in @(Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction SilentlyContinue)) {
            try {
                $owner = Invoke-CimMethod -InputObject $ex -MethodName GetOwner
                if ($owner -and $owner.User) {
                    $id = if ($owner.Domain) { "$($owner.Domain)\$($owner.User)" } else { [string]$owner.User }
                    Write-Host "INTERACTIVE_USER_EXPLORER=$id"
                    return $id
                }
            } catch {}
        }
    } catch {
        Write-Host "INTERACTIVE_USER_EXPLORER_FAILED=$($_.Exception.Message)"
    }
    try {
        Write-Host 'INTERACTIVE_QUSER_BEGIN'
        & quser.exe 2>&1 | ForEach-Object { Write-Host $_ }
        Write-Host 'INTERACTIVE_QUSER_END'
    } catch {
        Write-Host "INTERACTIVE_QUSER_FAILED=$($_.Exception.Message)"
    }
    return $null
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
    Write-Host "WATCHDOG_REFRESH_REQUEST=json source_sha=$Sha"
}

function Show-Diagnostics {
    param([string]$Label)
    Write-Host "--- DIAG $Label ---"
    Write-Host "DIAG_USER=$([Environment]::UserName)"
    Write-Host "DIAG_TOKEN_DECRYPTABLE=$(Test-CanDecryptToken)"
    Write-Host "DIAG_SOURCE_SHA=$sourceSha"
    Write-Host "DIAG_CONFIG_EXISTS=$(Test-Path $configPath)"
    Write-Host "DIAG_TOKEN_EXISTS=$(Test-Path $tokenPath)"
    Write-Host "DIAG_AGENT_EXISTS=$(Test-Path (Join-Path $runtimeDir 'aria-agent.js'))"
    Write-Host "DIAG_WATCHDOG_SCRIPT_EXISTS=$(Test-Path $watchdogScript)"
    if (Test-Path $runtimeShaPath) {
        Write-Host "DIAG_RUNTIME_SHA=$((Get-Content -Raw $runtimeShaPath).Trim())"
    }
    if (Test-Path $configPath) {
        try {
            $cfg = Get-Content -Raw $configPath | ConvertFrom-Json
            Write-Host "DIAG_DEVICE=$($cfg.device_id)"
            Write-Host "DIAG_NODE_PATH=$($cfg.node_path)"
            Write-Host "DIAG_NODE_EXISTS=$(Test-Path ([string]$cfg.node_path))"
        } catch {
            Write-Host "DIAG_CONFIG_PARSE_FAILED=$($_.Exception.Message)"
        }
    }
    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
        Write-Host "DIAG_LOGGED_ON=$($cs.UserName)"
    } catch {}
    if (Test-Path $tokenPath) {
        try {
            $encrypted = (Get-Content -Raw $tokenPath).Trim()
            $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
            Write-Host 'DIAG_TOKEN_DECRYPT=PASS'
        } catch {
            Write-Host "DIAG_TOKEN_DECRYPT=FAIL $($_.Exception.Message)"
        }
    }
    try {
        $statusRaw = if (Test-Path $statusPath) { Get-Content -Raw $statusPath } else { '' }
        Write-Host "DIAG_STATUS=$statusRaw"
    } catch {
        Write-Host "DIAG_STATUS_READ_FAILED=$($_.Exception.Message)"
    }
    Write-Host "DIAG_WATCHDOG_PID_FILE=$(Read-WatchdogPid)"
    if (Test-Path $agentPidPath) {
        Write-Host "DIAG_AGENT_PID_FILE=$((Get-Content -Raw $agentPidPath).Trim())"
    }
    try {
        $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -like '*aria-agent.js*'
        }
        Write-Host "DIAG_ARIA_NODE_COUNT=$(@($nodes).Count)"
        foreach ($n in @($nodes)) { Write-Host "DIAG_ARIA_NODE pid=$($n.ProcessId)" }
    } catch {
        Write-Host "DIAG_ARIA_NODE_SCAN_FAILED=$($_.Exception.Message)"
    }
    try {
        $wps = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -like '*run-agent.ps1*'
        }
        foreach ($w in @($wps)) { Write-Host "DIAG_WATCHDOG_PROCESS pid=$($w.ProcessId)" }
    } catch {
        Write-Host "DIAG_WATCHDOG_PROCESS_SCAN_FAILED=$($_.Exception.Message)"
    }
    if (Test-Path $watchdogLogPath) {
        Write-Host '--- watchdog.log tail ---'
        Get-Content -Path $watchdogLogPath -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host 'DIAG_WATCHDOG_LOG=missing'
    }
    Write-Host "--- END DIAG $Label ---"
}

function Start-WatchdogInInteractiveSession {
    $userId = Get-InteractiveUserId
    if ([string]::IsNullOrWhiteSpace($userId)) {
        throw 'No interactive user session found to start ARIA watchdog'
    }
    Write-Host "WATCHDOG_BOOTSTRAP_AS_USER=$userId"
    $ps = (Get-Command powershell.exe).Source
    $launcher = Join-Path $logDir 'start-watchdog-once.ps1'
    $launcherBody = @(
        "`$ErrorActionPreference = 'Continue'"
        "Start-Process -FilePath '$ps' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','$watchdogScript') -WorkingDirectory '$runtimeDir' -WindowStyle Hidden | Out-Null"
    ) -join "`r`n"
    Set-Content -Path $launcher -Value $launcherBody -Encoding ASCII -Force

    try { Unregister-ScheduledTask -TaskName $bootstrapTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}

    $registered = $false
    try {
        $action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`"" -WorkingDirectory $runtimeDir
        $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $bootstrapTaskName -Action $action -Principal $principal -Settings $settings -Force | Out-Null
        $registered = $true
        Write-Host 'WATCHDOG_TASK_REGISTERED=PASS'
        Start-ScheduledTask -TaskName $bootstrapTaskName
        Write-Host 'WATCHDOG_TASK_STARTED=PASS'
    } catch {
        Write-Host "WATCHDOG_TASK_CMDLET_FAILED=$($_.Exception.Message)"
        $tr = "$ps -NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
        $create = & schtasks.exe /Create /TN $bootstrapTaskName /TR $tr /SC ONCE /ST 23:59 /RU $userId /IT /F 2>&1
        Write-Host "WATCHDOG_SCHTASKS_CREATE=$create"
        $run = & schtasks.exe /Run /TN $bootstrapTaskName 2>&1
        Write-Host "WATCHDOG_SCHTASKS_RUN=$run"
        $registered = $true
    }

    $wp = 0
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 2
        $wp = Read-WatchdogPid
        if ($wp -gt 0 -and (Test-ProcessExists -ProcessId $wp)) {
            Write-Host "WATCHDOG_BOOTSTRAP_PID=$wp via=interactive_user"
            break
        }
        try {
            $info = Get-ScheduledTaskInfo -TaskName $bootstrapTaskName -ErrorAction SilentlyContinue
            if ($info) { Write-Host "WATCHDOG_TASK_RESULT t=$($i * 2)s last=$($info.LastTaskResult)" }
        } catch {}
    }
    if ($registered) {
        try { Unregister-ScheduledTask -TaskName $bootstrapTaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
        try { & schtasks.exe /Delete /TN $bootstrapTaskName /F 2>$null | Out-Null } catch {}
    }
    if ($wp -le 0) { Write-Host "WATCHDOG_BOOTSTRAP_PID=$wp via=interactive_user_timeout" }
    return $wp
}

function Start-WatchdogOwner {
    Write-Host 'WATCHDOG_BOOTSTRAP=START'
    if (-not (Test-Path $watchdogScript)) { throw "Watchdog script missing: $watchdogScript" }
    $canDecrypt = Test-CanDecryptToken
    Write-Host "WATCHDOG_TOKEN_DECRYPTABLE=$canDecrypt USER=$([Environment]::UserName)"
    if (-not $canDecrypt) {
        return Start-WatchdogInInteractiveSession
    }
    Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', $watchdogScript
    ) -WorkingDirectory $runtimeDir -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 5
    $wp = Read-WatchdogPid
    Write-Host "WATCHDOG_BOOTSTRAP_PID=$wp via=current_user"
    return $wp
}

function Stop-WatchdogOwner {
    param([int]$WatchdogProcessId)
    if ($WatchdogProcessId -gt 0 -and (Test-ProcessExists -ProcessId $WatchdogProcessId)) {
        try {
            Stop-Process -Id $WatchdogProcessId -Force -ErrorAction Stop
            Write-Host "OLD_WATCHDOG_STOPPED pid=$WatchdogProcessId"
        } catch {
            Write-Host "OLD_WATCHDOG_STOP_FAILED pid=$WatchdogProcessId err=$($_.Exception.Message)"
        }
    }
    try {
        $others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like '*run-agent.ps1*')
        }
        foreach ($p in @($others)) {
            try {
                Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction Stop
                Write-Host "STALE_WATCHDOG_STOPPED pid=$($p.ProcessId)"
            } catch {
                Write-Host "STALE_WATCHDOG_STOP_FAILED pid=$($p.ProcessId) err=$($_.Exception.Message)"
            }
        }
    } catch {
        Write-Host "STALE_WATCHDOG_SCAN_FAILED=$($_.Exception.Message)"
    }
    Start-Sleep -Seconds 3
    try { Remove-Item -Path $watchdogPidPath -Force -ErrorAction SilentlyContinue } catch {}
}

function Wait-AgentRefresh {
    param([string]$BeforePid, [int]$TimeoutSeconds, [string]$PassLabel)
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        Start-Sleep -Seconds 1
        $s = Read-Status
        if ($s -and [string]$s.state -eq 'agent_running' -and -not [string]::IsNullOrWhiteSpace([string]$s.agent_pid) -and [string]$s.agent_pid -ne $BeforePid) {
            Write-Host "$PassLabel old=$BeforePid new=$($s.agent_pid)"
            return $true
        }
        if (($i % 15) -eq 14 -and $s) {
            Write-Host "REFRESH_WAIT t=$($i + 1)s state=$($s.state) agent_pid=$($s.agent_pid) consecutive=$($s.consecutive_errors) last_error=$($s.last_error)$($s.error)"
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
$canDecrypt = Test-CanDecryptToken
$ownerError = ''
if ($s) { $ownerError = [string]$s.last_error + [string]$s.error + [string]$s.state }
$ownerTokenBroken = ($ownerError -match 'Clave no válida|Key not valid|estado especificado|watchdog_error|watchdog_exiting')

if (-not $ownerAlive) {
    Write-Host 'WATCHDOG_OWNER=absent'
    $watchdogPid = Start-WatchdogOwner
} elseif (-not $canDecrypt -and $ownerTokenBroken) {
    Write-Host "WATCHDOG_OWNER=broken_system_session pid=$watchdogPid replacing_with_interactive_user"
    Stop-WatchdogOwner -WatchdogProcessId $watchdogPid
    $watchdogPid = Start-WatchdogOwner
} else {
    Write-Host "WATCHDOG_ALREADY_RUNNING_PID=$watchdogPid"
}

Write-KillRequest -Reason 'certification-source-refresh' -Sha $sourceSha
$refreshed = Wait-AgentRefresh -BeforePid $before -TimeoutSeconds 90 -PassLabel 'AGENT_REFRESHED=PASS'

if (-not $refreshed) {
    Write-Host 'AGENT_REFRESH_TIMEOUT forcing clean watchdog restart'
    Show-Diagnostics -Label 'BEFORE_FORCE_RESTART'
    Stop-WatchdogOwner -WatchdogProcessId $watchdogPid
    $watchdogPid = Start-WatchdogOwner
    $refreshed = Wait-AgentRefresh -BeforePid $before -TimeoutSeconds 90 -PassLabel 'AGENT_REFRESHED_AFTER_FORCE=PASS'
}

if (-not $refreshed) {
    Show-Diagnostics -Label 'FINAL'
    throw 'Watchdog did not recover Agent after runtime synchronization'
}

Show-Diagnostics -Label 'AFTER_PASS'
Write-Host 'WATCHDOG_REFRESH=PASS'
exit 0
