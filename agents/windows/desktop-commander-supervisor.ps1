$ErrorActionPreference = 'Stop'

$DcVersion = '0.2.52'
$TaskName = 'ARIA-Desktop-Commander-Remote'
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$SupervisorLog = Join-Path $LogDir 'desktop-commander-supervisor.log'
$SupervisorStatus = Join-Path $LogDir 'desktop-commander-supervisor.json'
$PidPath = Join-Path $LogDir 'desktop-commander.pid'
$MutexName = 'Global\ARIA-DesktopCommander-Remote-Supervisor-v1'

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$created = $false
$mutex = New-Object System.Threading.Mutex($false, $MutexName, [ref]$created)
if (-not $created) {
    try { Add-Content -Path $SupervisorLog -Value "[DC-SUPERVISOR] $(Get-Date -Format o) DUPLICATE_SUPERVISOR_EXIT" -Encoding UTF8 } catch {}
    exit 0
}

function Write-Log([string]$Message) {
    $line = "[DC-SUPERVISOR] $(Get-Date -Format o) $Message"
    try { Add-Content -Path $SupervisorLog -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue } catch {}
}

function Write-Status([hashtable]$Fields) {
    try {
        $payload = [ordered]@{
            updated_at = (Get-Date -Format o)
            task_name = $TaskName
            version = $DcVersion
            supervisor_pid = $PID
        }
        foreach ($key in $Fields.Keys) { $payload[$key] = $Fields[$key] }
        ($payload | ConvertTo-Json -Compress) | Set-Content -Path $SupervisorStatus -Encoding UTF8 -Force
    } catch {}
}

function Resolve-DesktopCommander {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) {
        $candidate = 'D:\Databank\node.exe'
        if (Test-Path $candidate) { $node = Get-Command $candidate -ErrorAction Stop }
        else { throw 'node.exe no encontrado. Desktop Commander Remote no puede arrancar.' }
    }

    $toolRoot = Join-Path $RuntimeRoot 'Tools\DesktopCommanderRemote'
    $entry = Join-Path $toolRoot 'node_modules\@wonderwhy-er\desktop-commander\dist\index.js'
    if (-not (Test-Path $entry)) { throw "Desktop Commander persistent install missing: $entry" }

    return @{ node = $node.Source; entry = $entry; tool_root = $toolRoot }
}

function Get-TrackedProcess {
    if (-not (Test-Path $PidPath)) { return $null }

    $raw = ''
    try { $raw = (Get-Content -Raw -Path $PidPath).Trim() } catch {}
    $pidValue = 0
    if (-not [int]::TryParse($raw, [ref]$pidValue) -or $pidValue -le 0) {
        Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue
        return $null
    }

    $proc = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
    if ($proc) { return $proc }

    Remove-Item -Path $PidPath -Force -ErrorAction SilentlyContinue
    return $null
}

function Find-ExistingDesktopCommander {
    try {
        $procs = Get-CimInstance Win32_Process -ErrorAction Stop
        foreach ($proc in $procs) {
            $cmd = [string]$proc.CommandLine
            if ($cmd -match '(?i)desktop-commander' -and $cmd -match '(?i)remote') {
                return $proc.ProcessId
            }
        }
    } catch {
        Write-Log "PROCESS_SCAN_WARNING $($_.Exception.Message)"
    }

    return $null
}

function Start-DesktopCommander {
    $dc = Resolve-DesktopCommander
    $node = $dc.node
    $entry = $dc.entry
    $toolRoot = $dc.tool_root

    $env:NODE_OPTIONS = '--dns-result-order=ipv4first'
    $stdout = Join-Path $LogDir 'desktop-commander.stdout.log'
    $stderr = Join-Path $LogDir 'desktop-commander.stderr.log'

    Write-Log "START_REQUEST version=$DcVersion node=$node entry=$entry"

    $process = Start-Process -FilePath $node -ArgumentList @($entry, 'remote') -WorkingDirectory $toolRoot -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

    Set-Content -Path $PidPath -Value $process.Id -Encoding ASCII -Force
    Write-Log "STARTED pid=$($process.Id) version=$DcVersion"
    Write-Status @{
        state = 'starting'
        pid = $process.Id
        node = $node
        entry = $entry
        last_start = (Get-Date -Format o)
        auth_required = $false
        error = $null
    }
}

Write-Log "SUPERVISOR_START version=$DcVersion user=$env:USERNAME computer=$env:COMPUTERNAME"
Write-Status @{ state = 'supervisor_alive'; pid = $null; auth_required = $false; error = $null }

while ($true) {
    try {
        $tracked = Get-TrackedProcess

        if ($tracked) {
            Write-Status @{ state = 'running'; pid = $tracked.Id; auth_required = $false; error = $null }
            Start-Sleep -Seconds 10
            continue
        }

        $existingPid = Find-ExistingDesktopCommander
        if ($existingPid) {
            Set-Content -Path $PidPath -Value $existingPid -Encoding ASCII -Force
            Write-Log "ADOPT_EXISTING pid=$existingPid"
            Write-Status @{ state = 'adopted_existing'; pid = $existingPid; auth_required = $false; error = $null }
            Start-Sleep -Seconds 10
            continue
        }

        Start-DesktopCommander
        Start-Sleep -Seconds 15

        $child = Get-TrackedProcess
        if (-not $child) {
            Write-Log 'START_RESULT process_missing_after_15s check_stderr_for_details'
            $stderrPath = Join-Path $LogDir 'desktop-commander.stderr.log'
            $stderrTail = ''
            try { $stderrTail = (Get-Content -Path $stderrPath -Tail 8 -ErrorAction SilentlyContinue) -join ' | ' } catch {}

            $authRequired = $stderrTail -match '(?i)verify|authorization|authenticate|device code|pairing|sign in|auth'
            Write-Status @{
                state = if ($authRequired) { 'human_gate_auth_required' } else { 'start_failed' }
                pid = $null
                auth_required = [bool]$authRequired
                error = $stderrTail
            }

            if ($authRequired) {
                Write-Log 'HUMAN_GATE_AUTH_REQUIRED Desktop Commander needs interactive authorization/pairing'
            } else {
                Write-Log "START_FAILED stderr=$stderrTail"
            }

            Start-Sleep -Seconds 30
        }
    }
    catch {
        Write-Log "SUPERVISOR_ERROR $($_.Exception.Message)"
        Write-Status @{ state = 'error'; pid = $null; auth_required = $false; error = $_.Exception.Message }
        Start-Sleep -Seconds 30
    }
}