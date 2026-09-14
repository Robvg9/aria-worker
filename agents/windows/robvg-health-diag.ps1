$ErrorActionPreference = 'Continue'
$outDir = 'D:\ARIA-Windows-Agent\Logs'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$reportPath = Join-Path $outDir ("robvg-health-diag-" + $stamp + ".txt")
$lines = New-Object System.Collections.Generic.List[string]
function L([string]$s) { $lines.Add($s); Write-Host $s }

L "=== ROBVG HEALTH DIAG $stamp ==="
L "HOST=$env:COMPUTERNAME USER=$env:USERNAME"

# Uptime / boot
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $boot = $os.LastBootUpTime
  $uptime = (Get-Date) - $boot
  L ("BOOT=" + $boot.ToString('o'))
  L ("UPTIME_HOURS=" + [math]::Round($uptime.TotalHours, 2))
  L ("OS=" + $os.Caption + " " + $os.Version)
} catch { L ("BOOT_ERR=" + $_.Exception.Message) }

# RAM
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

# Commit / pagefile
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
  foreach ($s in @($pfset)) {
    L ("PAGEFILE_SETTING=" + $s.Name + " Initial=" + $s.InitialSize + " Max=" + $s.MaximumSize)
  }
  try {
    $auto = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management' -ErrorAction SilentlyContinue).PagingFiles
    L ("PAGEFILE_REG=" + ($auto -join ';'))
  } catch {}
} catch { L ("COMMIT_ERR=" + $_.Exception.Message) }

# Disk C:
try {
  $c = Get-PSDrive C
  $freeGB = [math]::Round($c.Free / 1GB, 2)
  $usedGB = [math]::Round(($c.Used) / 1GB, 2)
  $totalGB = [math]::Round(($c.Free + $c.Used) / 1GB, 2)
  $freePct = [math]::Round(100 * $c.Free / ($c.Free + $c.Used), 1)
  L ("C_TOTAL_GB=" + $totalGB)
  L ("C_USED_GB=" + $usedGB)
  L ("C_FREE_GB=" + $freeGB)
  L ("C_FREE_PCT=" + $freePct)
} catch { L ("DISK_ERR=" + $_.Exception.Message) }

# CPU
try {
  $cpu = Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average
  L ("CPU_LOAD_PCT=" + $cpu.Average)
  $perf = Get-Counter '\Processor(_Total)\% Processor Time' -ErrorAction SilentlyContinue
  if ($perf) { L ("CPU_PERF_PCT=" + [math]::Round($perf.CounterSamples[0].CookedValue, 1)) }
} catch { L ("CPU_ERR=" + $_.Exception.Message) }

# Top processes by WorkingSet
L '--- TOP20_RAM ---'
try {
  Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 |
    ForEach-Object {
      L ("RAM_MB=" + [math]::Round($_.WorkingSet64/1MB,1) + " CPU=" + $_.CPU + " PID=" + $_.Id + " NAME=" + $_.ProcessName)
    }
} catch { L ("TOP_RAM_ERR=" + $_.Exception.Message) }

L '--- TOP20_CPU ---'
try {
  Get-Process | Sort-Object CPU -Descending | Select-Object -First 20 |
    ForEach-Object {
      L ("CPU=" + [math]::Round($_.CPU,1) + " RAM_MB=" + [math]::Round($_.WorkingSet64/1MB,1) + " PID=" + $_.Id + " NAME=" + $_.ProcessName)
    }
} catch { L ("TOP_CPU_ERR=" + $_.Exception.Message) }

# Disk IO if available
L '--- DISK_IO_SAMPLE ---'
try {
  $disk = Get-Counter '\PhysicalDisk(_Total)\Disk Bytes/sec','\PhysicalDisk(_Total)\% Disk Time' -ErrorAction SilentlyContinue
  if ($disk) {
    foreach ($s in $disk.CounterSamples) {
      L ("IO=" + $s.Path + "=" + [math]::Round($s.CookedValue, 1))
    }
  } else { L 'IO=unavailable' }
} catch { L ("IO_ERR=" + $_.Exception.Message) }

# Services abnormal
L '--- SERVICES_ABNORMAL ---'
try {
  Get-Service | Where-Object { $_.Status -notin @('Running','Stopped') } |
    ForEach-Object { L ("SVC=" + $_.Name + " STATUS=" + $_.Status + " START=" + $_.StartType) }
  Get-Service | Where-Object { $_.StartType -eq 'Automatic' -and $_.Status -ne 'Running' } |
    Select-Object -First 30 | ForEach-Object { L ("AUTO_NOT_RUNNING=" + $_.Name + " STATUS=" + $_.Status) }
} catch { L ("SVC_ERR=" + $_.Exception.Message) }

# Recent critical/error events
L '--- EVENT_LOG_ERROR_24H ---'
try {
  $since = (Get-Date).AddHours(-24)
  Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=$since} -MaxEvents 25 -ErrorAction SilentlyContinue |
    ForEach-Object { L ("EVT=" + $_.TimeCreated.ToString('s') + " ID=" + $_.Id + " SRC=" + $_.ProviderName + " " + ($_.Message -replace "`r?`n",' ').Substring(0, [Math]::Min(180, ($_.Message -replace "`r?`n",' ').Length))) }
} catch { L ("EVT_ERR=" + $_.Exception.Message) }

L '--- APPLICATION_ERROR_24H ---'
try {
  $since = (Get-Date).AddHours(-24)
  Get-WinEvent -FilterHashtable @{LogName='Application'; Level=1,2; StartTime=$since} -MaxEvents 25 -ErrorAction SilentlyContinue |
    ForEach-Object { L ("AEVT=" + $_.TimeCreated.ToString('s') + " ID=" + $_.Id + " SRC=" + $_.ProviderName + " " + ($_.Message -replace "`r?`n",' ').Substring(0, [Math]::Min(180, ($_.Message -replace "`r?`n",' ').Length))) }
} catch { L ("AEVT_ERR=" + $_.Exception.Message) }

# WER recent
L '--- WER_RECENT ---'
try {
  $wer = 'C:\ProgramData\Microsoft\Windows\WER\ReportQueue'
  if (Test-Path $wer) {
    Get-ChildItem $wer -Directory -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 15 |
      ForEach-Object { L ("WER=" + $_.Name + " TIME=" + $_.LastWriteTime.ToString('s')) }
  } else { L 'WER=no_queue' }
} catch { L ("WER_ERR=" + $_.Exception.Message) }

# OneDrive / Edge / Update / Defender / Docker
L '--- KEY_PROCESSES ---'
foreach ($name in @('OneDrive','msedge','MsMpEng','WinStore.App','TiWorker','UsoSvc','wuauclt','Docker Desktop','com.docker.backend','node','powershell','Runner.Listener','Runner.Worker')) {
  $ps = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
  if ($ps.Count -gt 0) {
    $ram = ($ps | Measure-Object WorkingSet64 -Sum).Sum
    L ("PROC=" + $name + " COUNT=" + $ps.Count + " RAM_MB=" + [math]::Round($ram/1MB,1))
  } else { L ("PROC=" + $name + " COUNT=0") }
}

# Windows Update
try {
  $wu = Get-Service wuauserv -ErrorAction SilentlyContinue
  L ("WU_SERVICE=" + $wu.Status + " START=" + $wu.StartType)
} catch { L 'WU_SERVICE=err' }
try {
  $mp = Get-Service WinDefend -ErrorAction SilentlyContinue
  L ("DEFENDER=" + $mp.Status)
} catch { L 'DEFENDER=err' }

# ARIA state
L '--- ARIA ---'
$logDir = 'D:\ARIA-Windows-Agent\Logs'
$statusPath = Join-Path $logDir 'status.json'
if (Test-Path $statusPath) { L ("STATUS=" + (Get-Content -Raw $statusPath)) } else { L 'STATUS=missing' }
foreach ($f in @('watchdog.pid','agent.pid','watchdog.log','runtime-source-sha')) {
  $p = Join-Path $logDir $f
  if (Test-Path $p) {
    if ($f -like '*.log') { L ("FILE=" + $f + " TAIL:"); Get-Content $p -Tail 8 -ErrorAction SilentlyContinue | ForEach-Object { L $_ } }
    else { L ("FILE=" + $f + "=" + (Get-Content -Raw $p).Trim()) }
  } else { L ("FILE=" + $f + "=missing") }
}
$med = 'D:\ARIA-Windows-Agent\Runtime\meditation\state.json'
if (Test-Path $med) { L ("MEDITATION_STATE=" + (Get-Content -Raw $med)) } else { L 'MEDITATION_STATE=missing' }
$medLog = 'D:\ARIA-Windows-Agent\Runtime\meditation\ARIA-Meditation-IA.txt'
if (Test-Path $medLog) { L 'MEDITATION_LOG_TAIL:'; Get-Content $medLog -Tail 10 -ErrorAction SilentlyContinue | ForEach-Object { L $_ } }

try {
  $node = if (Test-Path 'D:\Databank\node\node.exe') { & 'D:\Databank\node\node.exe' -v } else { node -v }
  L ("NODE=" + $node)
} catch { L ("NODE_ERR=" + $_.Exception.Message) }

# Live ARIA processes
try {
  $wd = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*run-agent.ps1*' }
  L ("LIVE_WATCHDOG_COUNT=" + @($wd).Count)
  foreach ($w in @($wd)) {
    $o = Invoke-CimMethod -InputObject $w -MethodName GetOwner -ErrorAction SilentlyContinue
    L ("WATCHDOG pid=" + $w.ProcessId + " session=" + $w.SessionId + " user=" + $o.Domain + "\" + $o.User)
  }
  $ag = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*aria-agent.js*' }
  L ("LIVE_AGENT_COUNT=" + @($ag).Count)
  foreach ($a in @($ag)) {
    $o = Invoke-CimMethod -InputObject $a -MethodName GetOwner -ErrorAction SilentlyContinue
    L ("AGENT pid=" + $a.ProcessId + " session=" + $a.SessionId + " user=" + $o.Domain + "\" + $o.User)
  }
} catch { L ("ARIA_PROC_ERR=" + $_.Exception.Message) }

# Temp sizes (info only)
try {
  $tmp = $env:TEMP
  if (Test-Path $tmp) {
    $sz = (Get-ChildItem $tmp -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    L ("TEMP_SIZE_MB=" + [math]::Round($sz/1MB,1) + " PATH=" + $tmp)
  }
  $wtmp = 'C:\Windows\Temp'
  if (Test-Path $wtmp) {
    $sz = (Get-ChildItem $wtmp -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    L ("WINTEMP_SIZE_MB=" + [math]::Round($sz/1MB,1))
  }
} catch { L ("TEMP_ERR=" + $_.Exception.Message) }

L "=== END DIAG ==="
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$lines | Set-Content -Path $reportPath -Encoding UTF8
Write-Host ("REPORT_PATH=" + $reportPath)
exit 0
