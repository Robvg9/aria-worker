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
$MutexName = 'Global\ARIA-DesktopCommander-Supervisor-v2'

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

function Start-DesktopCommander {
    if (-not (Test-Path $NodePath)) { throw "NODE_NOT_FOUND:$NodePath" }
    if (-not (Test-Path $DcEntry)) { throw "DC_RUNTIME_NOT_FOUND:$DcEntry" }
    $env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'
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
            Write-Status 'running' $desktopCommanderPid
            Start-Sleep -Seconds 10
            continue
        }

        Start-DesktopCommander
        Start-Sleep -Seconds 20
        $desktopCommanderPid = Find-DesktopCommander

        if ($desktopCommanderPid -gt 0) {
            Write-Log "CHILD_CONFIRMED pid=$desktopCommanderPid"
            Write-Status 'running' $desktopCommanderPid
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
