$ErrorActionPreference = 'Continue'
$outDir = 'D:\ARIA-Windows-Agent\Logs'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $outDir ("robvg-health-diag-" + $stamp + ".txt")
$lines = New-Object System.Collections.Generic.List[string]
function L([string]$s) { $lines.Add($s); Write-Host $s }

L "=== ROBVG HEALTH DIAG $stamp ==="
L "HOST=$env:COMPUTERNAME USER=$env:USERNAME"

try {
  $os = Get-CimInstance Win32_OperatingSystem
  $boot = $os.LastBootUpTime
  $uptime = (Get-Date) - $boot
  L ("BOOT=" + $boot.ToString('o'))
  L ("UPTIME_HOURS=" + [math]::Round($uptime.TotalHours, 2))
  L ("OS=" + $os.Caption + " " + $os.Version)
} catch { L ("BOOT_ERR=" + $_.Exception.Message) }

try {
  $os = Get-CimInstance Win32_OperatingSystem
  $totalMB = [math]::Round($os.TotalVisibleMemorySize / 1024, 1)
  $freeMB = [math]::Round($os.FreePhysicalMemory / 1024, 1)
  $usedMB = [math]::Round($totalMB - $freeMB, 1)
  $pctUsed = [math]::Round(100 * $usedMB / $totalMB, 1)
  L ("RAM_TOTAL_MB=" + $totalMB)
  L ("RAM_FREE_MB=" + $freeMB)
  L ("RAM_USED_MB=" + $usedMB)
  L ("RAM_USED_PCT=" + $pctUsed)
} catch { L ("RAM_ERR=" + $_.Exception.Message) }

try {
  $os = Get-CimInstance Win32_OperatingSystem
  L ("COMMIT_LIMIT_KB=" + $os.TotalVirtualMemorySize)
  L ("COMMIT_FREE_KB=" + $os.FreeVirtualMemory)
  L ("COMMIT_USED_KB=" + ($os.TotalVirtualMemorySize - $os.FreeVirtualMemory))
  $pf = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue
  foreach ($p in @($pf)) {
    L ("PAGEFILE_NAME=" + $p.Name)
    L ("PAGEFILE_ALLOCATED_MB=" + $p.AllocatedBaseSize)
    L ("PAGEFILE_CURRENT_MB=" + $p.CurrentUsage)
    L ("PAGEFILE_PEAK_MB=" + $p.PeakUsage)
  }
  $pfset = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue
  foreach ($s in @($pfset)) { L ("PAGEFILE_SETTING=" + $s.Name + " Initial=" + $s.InitialSize + " Max=" + $s.MaximumSize) }
} catch { L ("COMMIT_ERR=" + $_.Exception.Message) }

try {
  $c = Get-PSDrive C
  $freeGB = [math]::Round($c.Free / 1GB, 2)
  $usedGB = [math]::Round($c.Used / 1GB, 2)
  $totalGB = [math]::Round(($c.Free + $c.Used) / 1GB, 2)
  $freePct = [math]::Round(100 * $c.Free / ($c.Free + $c.Used), 1)
  L ("C_TOTAL_GB=" + $totalGB)
  L ("C_USED_GB=" + $usedGB)
  L ("C_FREE_GB=" + $freeGB)
  L ("C_FREE_PCT=" + $freePct)
} catch { L ("DISK_ERR=" + $_.Exception.Message) }

try {
  $cpu = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
  L ("CPU_LOAD_PCT=" + $cpu.Average)
  $perf = Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction SilentlyContinue
  if ($perf) { L ("CPU_PERF_PCT=" + [math]::Round($perf.CounterSamples[0].CookedValue, 1)) }
} catch { L ("CPU_ERR=" + $_.Exception.Message) }

L '--- TOP20_RAM ---'
try {
  Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 |
    ForEach-Object { L ("RAM_MB=" + [math]::Round($_.WorkingSet64/1MB,1) + " CPU=" + $_.CPU + " PID=" + $_.Id + " NAME=" + $_.ProcessName) }
} catch { L ("TOP_RAM_ERR=" + $_.Exception.Message) }

L '--- TOP20_CPU ---'
try {
  Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 |
    ForEach-Object { L ("CPU=" + [math]::Round($_.CPU,1) + " RAM_MB=" + [math]::Round($_.WorkingSet64/1MB,1) + " PID=" + $_.Id + " NAME=" + $_.ProcessName) }
} catch { L ("TOP_CPU_ERR=" + $_.Exception.Message) }

L '--- DISK_IO_SAMPLE ---'
try {
  $disk = Get-Counter '\PhysicalDisk(_Total)\Disk Bytes/sec','\PhysicalDisk(_Total)\% Disk Time' -ErrorAction SilentlyContinue
  if ($disk) { foreach ($s in $disk.CounterSamples) { L ("IO=" + $s.Path + "=" + [math]::Round($s.CookedValue, 1)) } }
  else { L 'IO=unavailable' }
} catch { L ("IO_ERR=" + $_.Exception.Message) }

L '--- SERVICES_ABNORMAL ---'
try {
  Get-Service | Where-Object { $_.Status -notin @('Running','Stopped') } |
    ForEach-Object { L ("SVC=" + $_.Name + " STATUS=" + $_.Status + " START=" + $_.StartType) }
  Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } |
    Select-Object -First 30 | ForEach-Object { L ("AUTO_NOT_RUNNING=" + $_.Name + " STATUS=" + $_.Status) }
} catch { L ("SVC_ERR=" + $_.Exception.Message) }

L '--- EVENT_LOG_ERROR_24H ---'
try {
  $since = (Get-Date).AddHours(-24)
  Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=$since} -MaxEvents 25 -ErrorAction SilentlyContinue |
    ForEach-Object {
      $msg = ($_.Message -replace "`r?`n", ' ')
      L ("EVT=" + $_.TimeCreated.ToString('s') + " ID=" + $_.Id + " SRC=" + $_.ProviderName + " " + $msg.Substring(0, [Math]::Min(180, $msg.Length)))
    }
} catch { L ("EVT_ERR=" + $_.Exception.Message) }

L '--- APPLICATION_ERROR_24H ---'
try {
  $since = (Get-Date).AddHours(-24)
  Get-WinEvent -FilterHashtable @{LogName='Application'; Level=1,2; StartTime=$since} -MaxEvents 25 -ErrorAction SilentlyContinue |
    ForEach-Object {
      $msg = ($_.Message -replace "`r?`n", ' ')
      L ("AEVT=" + $_.TimeCreated.ToString('s') + " ID=" + $_.Id + " SRC=" + $_.ProviderName + " " + $msg.Substring(0, [Math]::Min(180, $msg.Length)))
    }
} catch { L ("AEVT_ERR=" + $_.Exception.Message) }

L '--- WER_RECENT ---'
try {
  $wer = 'C:\ProgramData\Microsoft\Windows\WER\ReportQueue'
  if (Test-Path $wer) {
    Get-ChildItem $wer -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 15 |
      ForEach-Object { L ("WER=" + $_.Name + " TIME=" + $_.LastWriteTime.ToString('s')) }
  } else { L 'WER=no_queue' }
} catch { L ("WER_ERR=" + $_.Exception.Message) }

L '--- KEY_PROCESSES ---'
foreach ($name in @('OneDrive','msedge','MsMpEng','WinStore.App','TiWorker','UsoSvc','wuauclt','Docker Desktop','com.docker.backend','node','powershell','Runner.Listener','Runner.Worker')) {
  $ps = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
  if ($ps.Count -gt 0) {
    $ram = ($ps | Measure-Object WorkingSet64 -Sum).Sum
    L ("PROC=" + $name + " COUNT=" + $ps.Count + " RAM_MB=" + [math]::Round($ram/1MB,1))
  } else { L ("PROC=" + $name + " COUNT=0") }
}

try {
  $wu = Get-Service wuauserv -ErrorAction SilentlyContinue
  L ("WU_SERVICE=" + $wu.Status + " START=" + $wu.StartType)
} catch { L 'WU_SERVICE=err' }
try {
  $mp = Get-Service WinDefend -ErrorAction SilentlyContinue
  L ("DEFENDER=" + $mp.Status)
} catch { L 'DEFENDER=err' }

# --- ARIA: compact only. Never dump state.json/checkpoint JSON. ---
L '--- ARIA_COMPACT ---'
$logDir = 'D:\ARIA-Windows-Agent\Logs'
$statusPath = Join-Path $logDir 'status.json'
if (Test-Path $statusPath) {
  try {
    $st = Get-Content -Raw $statusPath | ConvertFrom-Json
    L ("ARIA_STATE=" + $st.state)
    L ("ARIA_AGENT_PID=" + $st.agent_pid)
    L ("ARIA_WATCHDOG_PID=" + $st.watchdog_pid)
    L ("ARIA_SHA=" + $st.runtime_source_sha)
    if ($st.last_exit_code) { L ("ARIA_LAST_EXIT=" + $st.last_exit_code) }
    if ($st.last_error) { L ("ARIA_LAST_ERROR=" + ([string]$st.last_error).Substring(0,[Math]::Min(180,[string]$st.last_error).Length)) }
  } catch { L 'ARIA_STATUS=parse_error' }
} else { L 'ARIA_STATUS=missing' }

foreach ($f in @('watchdog.pid','agent.pid','runtime-source-sha')) {
  $p = Join-Path $logDir $f
  if (Test-Path $p) { L ("ARIA_FILE=" + $f + "=" + (Get-Content -Raw $p -ErrorAction SilentlyContinue).Trim()) }
  else { L ("ARIA_FILE=" + $f + "=missing") }
}

$med = 'D:\ARIA-Windows-Agent\Runtime\meditation\state.json'
if (Test-Path $med) {
  try {
    $m = Get-Content -Raw $med | ConvertFrom-Json
    L ("MEDITATION_STATUS=" + $m.status)
    L ("MEDITATION_MODE=" + $m.mode)
    L ("MEDITATION_TICK_COUNT=" + $m.tick_count)
    L ("MEDITATION_SESSION=" + $m.session_id)
    L ("MEDITATION_MISSION_ID=" + $m.mission_id)
  } catch { L 'MEDITATION_STATE=parse_error' }
} else { L 'MEDITATION_STATE=missing' }

$medLog = 'D:\ARIA-Windows-Agent\Runtime\meditation\ARIA-Meditation-IA.txt'
if (Test-Path $medLog) {
  L 'MEDITATION_LOG_TAIL:'
  Get-Content $medLog -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { L $_ }
}

try {
  $node = if (Test-Path 'D:\Databank\node\node.exe') { & 'D:\Databank\node\node.exe' -v } else { node -v }
  L ("NODE=" + $node)
} catch { L ("NODE_ERR=" + $_.Exception.Message) }

try {
  $wd = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*run-agent.ps1*' })
  L ("LIVE_WATCHDOG_COUNT=" + $wd.Count)
  foreach ($w in $wd) {
    $o = Invoke-CimMethod -InputObject $w -MethodName GetOwner -ErrorAction SilentlyContinue
    L ("WATCHDOG pid=" + $w.ProcessId + " session=" + $w.SessionId + " user=" + $o.Domain + "\" + $o.User)
  }
  $ag = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*aria-agent.js*' })
  L ("LIVE_AGENT_COUNT=" + $ag.Count)
  foreach ($a in $ag) {
    $o = Invoke-CimMethod -InputObject $a -MethodName GetOwner -ErrorAction SilentlyContinue
    L ("AGENT pid=" + $a.ProcessId + " session=" + $a.SessionId + " user=" + $o.Domain + "\" + $o.User)
  }
} catch { L ("ARIA_PROC_ERR=" + $_.Exception.Message) }

# Only measure temp directories; do not recursively enumerate the entire C: drive.
try {
  $tmp = $env:TEMP
  if (Test-Path $tmp) {
    $files = Get-ChildItem $tmp -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum
    L ("TEMP_DIRECT_MB=" + [math]::Round(($files.Sum/1MB),1))
  }
  $wtmp = 'C:\Windows\Temp'
  if (Test-Path $wtmp) {
    $files = Get-ChildItem $wtmp -File -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum
    L ("WINTEMP_DIRECT_MB=" + [math]::Round(($files.Sum/1MB),1))
  }
} catch { L ("TEMP_ERR=" + $_.Exception.Message) }

L "=== END DIAG ==="
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$lines | Set-Content -Path $reportPath -Encoding UTF8
Write-Host ("REPORT_PATH=" + $reportPath)
exit 0
