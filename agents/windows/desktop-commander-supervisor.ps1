$ErrorActionPreference = 'Stop'

# ARIA-managed Desktop Commander supervisor.
# Launched by the existing ARIA Windows watchdog task.
# It is transport infrastructure only; ARIA remains authoritative.

$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$ToolRoot = Join-Path $RuntimeRoot 'Tools\DesktopCommanderRemote'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$LogPath = Join-Path $LogDir 'desktop-commander-supervisor.log'
$StatusPath = Join-Path $LogDir 'desktop-commander-supervisor.json'
$ConfigPath = Join-Path $RuntimeRoot 'Data\config.json'
$NodeCandidates = @(
    'D:\Databank\node.exe',
    'D:\Databank\node\node.exe'
)
$ConfiguredNodePath = $null
if (Test-Path $ConfigPath) {
    try {
        $cfg = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
        $ConfiguredNodePath = [string]$cfg.node_path
    } catch {}
}
$NodeCandidates = @($ConfiguredNodePath) + $NodeCandidates |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
    Select-Object -Unique
$NodePath = $NodeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $NodePath) { $NodePath = $NodeCandidates[0] }

$DcEntry = Join-Path $ToolRoot 'node_modules\@wonderwhy-er\desktop-commander\dist\index.js'
$DcVersion = '0.2.52'
$McpServerUrl = 'https://mcp.desktopcommander.app'
$MutexName = 'Global\ARIA-DesktopCommander-Supervisor-v2'

# Bounded recovery for a live process whose remote channel is persistently degraded.
$ChannelDegradedSince = $null
$ChannelRestartTimes = New-Object 'System.Collections.Generic.List[datetime]'
$ChannelRestartThresholdSeconds = 180
$ChannelRestartMaxPerHour = 2
$ChannelRestartLimitLastLog = $null
$ChannelBackendDegradedLastLog = $null

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$created = $false
$mutex = New-Object System.Threading.Mutex($false, $MutexName, [ref]$created)
if (-not $created) { exit 0 }

function Write-Log([string]$Message) {
    try { Add-Content -Path $LogPath -Value "[ARIA-DC] $(Get-Date -Format o) $Message" -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
}

function Write-Status([string]$State,[int]$ProcessId=0,[string]$ErrorText=$null) {
    $obj = [ordered]@{
        updated_at = (Get-Date -Format o)
        state = $State
        process_alive = ($ProcessId -gt 0)
        channel_state = if ($State -eq 'channel_last_subscribed') { 'subscribed' } elseif ($State -eq 'channel_degraded') { 'degraded' } elseif ($State -eq 'channel_unverified') { 'unverified' } else { 'unknown' }
        pid = if($ProcessId -gt 0){$ProcessId}else{$null}
        version = $DcVersion
        node = $NodePath
        entry = $DcEntry
        error = $ErrorText
    }
    ($obj | ConvertTo-Json -Compress) | Set-Content -Path $StatusPath -Encoding UTF8 -Force
}

function Find-DesktopCommander {
    try {
        $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop
        foreach ($proc in $procs) {
            $cmd = [string]$proc.CommandLine
            if ($cmd -match '(?i)desktop-commander' -and $cmd -match '(?i)remote') { return [int]$proc.ProcessId }
        }
    } catch { Write-Log "PROCESS_SCAN_ERROR $(($_.Exception).Message)" }
    return 0
}

function Get-RemoteChannelState {
    # A live node.exe process is not proof that the Remote MCP channel is usable.
    # Desktop Commander reports an affirmative subscription with "Channel subscribed".
    $stdout = Join-Path $LogDir 'desktop-commander.stdout.log'
    $stderr = Join-Path $LogDir 'desktop-commander.stderr.log'
    $lines = @()
    if (Test-Path $stdout) {
        try { $lines = @(Get-Content -Path $stdout -Tail 300 -ErrorAction Stop) } catch {}
    }

    $lastSuccess = -1
    $lastFailure = -1
    $lastFailureLine = $null
    $lastHostedFailure = -1
    $lastHostedFailureLine = $null
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = [string]$lines[$i]
        if ($line -match '(?i)Channel subscribed|Status:\s*Online') {
            $lastSuccess = $i
        }
        if ($line -match '(?i)IncreaseConnectionPool|fetch failed|upstream connect error|reset reason:\s*overflow|Cloudflare.{0,30}525|SSL handshake failed') {
            $lastHostedFailure = $i
            $lastHostedFailureLine = $line
        }
        if ($line -match '(?i)IncreaseConnectionPool|Channel error:|Channel subscription timed out|Device registered, but NOT reachable|Realtime channel is not open|socket closed:\s*1006|Failed to connect to Desktop Commander MCP|Failed to connect to Remote MCP|Recreating channel|Failed to set session|Failed to set status offline|Failed to update transport capability|fetch failed|upstream connect error|reset reason:\s*overflow|Cloudflare.{0,30}525|SSL handshake failed') {
            $lastFailure = $i
            $lastFailureLine = $line
        }
    }

    # Use stderr as a fallback diagnostic when stdout has no channel evidence.
    if ($lastSuccess -lt 0 -and $lastFailure -lt 0 -and (Test-Path $stderr)) {
        try {
            $errLines = @(Get-Content -Path $stderr -Tail 80 -ErrorAction Stop)
            if ($errLines.Count -gt 0) {
                $lastFailureLine = ($errLines | Select-Object -Last 1)
                $joinedErr = $errLines -join [Environment]::NewLine
                if ($joinedErr -match '(?i)error|failed|not connected|timeout|IncreaseConnectionPool') {
                    $hostedFailure = $joinedErr -match '(?i)IncreaseConnectionPool|fetch failed|upstream connect error|reset reason:\s*overflow|Cloudflare.{0,30}525|SSL handshake failed'
                    return [pscustomobject]@{ State = 'channel_degraded'; Detail = [string]$lastFailureLine; HostedFailure = [bool]$hostedFailure }
                }
            }
        } catch {}
    }

    if ($lastFailure -gt $lastSuccess) {
        $hostedFailure = $lastHostedFailure -gt $lastSuccess
        $detail = if ($hostedFailure) { [string]$lastHostedFailureLine } else { [string]$lastFailureLine }
        return [pscustomobject]@{ State = 'channel_degraded'; Detail = $detail; HostedFailure = [bool]$hostedFailure }
    }
    if ($lastSuccess -ge 0) {
        return [pscustomobject]@{ State = 'channel_last_subscribed'; Detail = 'Last observed Channel subscribed; no newer channel error appears in the captured stdout tail. This is log evidence, not a live remote ping.'; HostedFailure = $false }
    }
    return [pscustomobject]@{ State = 'channel_unverified'; Detail = 'Process exists, but no Channel subscribed confirmation is present in recent stdout.'; HostedFailure = $false }
}

function Write-ObservedChannelStatus([int]$ProcessId) {
    $channel = Get-RemoteChannelState
    Write-Status $channel.State $ProcessId $channel.Detail
    Write-Log "REMOTE_CHANNEL_STATE state=$($channel.State) pid=$ProcessId detail=$($channel.Detail)"
    return $channel
}

function Invoke-ChannelRecovery([int]$ProcessId,[string]$State,[string]$ChannelDetail,[bool]$HostedFailure=$false) {
    $now = Get-Date
    for ($i = $script:ChannelRestartTimes.Count - 1; $i -ge 0; $i--) {
        if ($script:ChannelRestartTimes[$i] -lt $now.AddHours(-1)) {
            $script:ChannelRestartTimes.RemoveAt($i)
        }
    }

    if ($State -ne 'channel_degraded') {
        $script:ChannelDegradedSince = $null
        return $false
    }

    # Do not worsen known hosted Realtime/session outages by repeatedly restarting
    # the client: each restart can create another private-channel join/token refresh.
    if ($HostedFailure -or $ChannelDetail -match '(?i)IncreaseConnectionPool|fetch failed|upstream connect error|reset reason:\s*overflow|Cloudflare.{0,30}525|SSL handshake failed') {
        $script:ChannelDegradedSince = $null
        if ($null -eq $script:ChannelBackendDegradedLastLog -or ($now - $script:ChannelBackendDegradedLastLog).TotalMinutes -ge 5) {
            Write-Log "CHANNEL_BACKEND_DEGRADED_NO_RESTART reason=hosted_transport_or_capacity detail=$ChannelDetail"
            $script:ChannelBackendDegradedLastLog = $now
        }
        return $false
    }

    if ($null -eq $script:ChannelDegradedSince) {
        $script:ChannelDegradedSince = $now
        Write-Log 'CHANNEL_DEGRADED_TIMER_STARTED threshold_seconds=180'
        return $false
    }

    $degradedSeconds = [int]($now - $script:ChannelDegradedSince).TotalSeconds
    if ($degradedSeconds -lt $script:ChannelRestartThresholdSeconds) { return $false }

    if ($script:ChannelRestartTimes.Count -ge $script:ChannelRestartMaxPerHour) {
        if ($null -eq $script:ChannelRestartLimitLastLog -or ($now - $script:ChannelRestartLimitLastLog).TotalMinutes -ge 10) {
            Write-Log "CHANNEL_RESTART_LIMIT_REACHED window_minutes=60 max=$script:ChannelRestartMaxPerHour state=$State"
            $script:ChannelRestartLimitLastLog = $now
        }
        $script:ChannelDegradedSince = $now
        return $false
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        $script:ChannelRestartTimes.Add($now)
        Write-Log "CHANNEL_RESTART_REQUESTED reason=persistent_channel_degraded duration_seconds=$degradedSeconds pid=$ProcessId restart_count_hour=$($script:ChannelRestartTimes.Count)"
        Write-Status 'channel_restart_requested' $ProcessId 'Channel stayed degraded for 180 seconds; supervisor will restart the child process.'
        $script:ChannelDegradedSince = $now
        return $true
    } catch {
        Write-Log "CHANNEL_RESTART_FAILED pid=$ProcessId error=$($_.Exception.Message)"
        $script:ChannelDegradedSince = $now
        return $false
    }
}

function Start-DesktopCommander {
    if (-not (Test-Path $NodePath)) { throw "NODE_NOT_FOUND:$NodePath" }
    if (-not (Test-Path $DcEntry)) { throw "DC_RUNTIME_NOT_FOUND:$DcEntry" }
    $env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'
    $env:MCP_SERVER_URL = $McpServerUrl
    $stdout = Join-Path $LogDir 'desktop-commander.stdout.log'
    $stderr = Join-Path $LogDir 'desktop-commander.stderr.log'
    Write-Log "START_REQUEST version=$DcVersion node=$NodePath entry=$DcEntry"
    $p = Start-Process -FilePath $NodePath -ArgumentList @($DcEntry,'remote') -WorkingDirectory $ToolRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    Write-Log "STARTED pid=$($p.Id)"
    Write-Status 'starting' $p.Id
}

Write-Log "SUPERVISOR_START version=$DcVersion user=$env:USERNAME computer=$env:COMPUTERNAME node=$NodePath"
Write-Status 'supervisor_alive'

while ($true) {
    try {
        $desktopCommanderPid = Find-DesktopCommander
        if ($desktopCommanderPid -gt 0) {
            $channel = Write-ObservedChannelStatus $desktopCommanderPid
            Invoke-ChannelRecovery -ProcessId $desktopCommanderPid -State $channel.State -ChannelDetail $channel.Detail -HostedFailure ([bool]$channel.HostedFailure) | Out-Null
            Start-Sleep -Seconds 10
            continue
        }

        Start-DesktopCommander
        Start-Sleep -Seconds 20
        $desktopCommanderPid = Find-DesktopCommander

        if ($desktopCommanderPid -gt 0) {
            Write-Log "CHILD_CONFIRMED process_alive=True pid=$desktopCommanderPid; remote channel still requires explicit confirmation"
            $channel = Write-ObservedChannelStatus $desktopCommanderPid
            Invoke-ChannelRecovery -ProcessId $desktopCommanderPid -State $channel.State | Out-Null
            Start-Sleep -Seconds 10
            continue
        }

        $stderr = Join-Path $LogDir 'desktop-commander.stderr.log'
        $tail = if (Test-Path $stderr) { (Get-Content -Path $stderr -Tail 12 -ErrorAction SilentlyContinue) -join ' | ' } else { 'DC_EXITED_WITHOUT_STDERR' }
        if ([string]::IsNullOrWhiteSpace($tail)) { $tail = 'DC_EXITED_WITHOUT_STDERR' }
        Write-Log "CHILD_EXITED error=$tail"
        Write-Status 'retrying' 0 $tail
        Start-Sleep -Seconds 30
    }
    catch {
        Write-Log "SUPERVISOR_ERROR $(($_.Exception).Message)"
        Write-Status 'error' 0 $_.Exception.Message
        Start-Sleep -Seconds 30
    }
}
