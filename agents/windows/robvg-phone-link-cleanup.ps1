$ErrorActionPreference = 'Continue'
function L([string]$s){ Write-Host $s }

L '=== ROBVG_PHONE_LINK_CLEANUP ==='
L ("HOST=" + $env:COMPUTERNAME)
L ("USER=" + $env:USERNAME)
L ("WHEN=" + (Get-Date).ToUniversalTime().ToString('o'))

# --- Compact pre metrics (no JSON dumps) ---
try {
  $os = Get-CimInstance Win32_OperatingSystem
  $ramTotalGB = [math]::Round($os.TotalVisibleMemorySize/1MB, 2)
  $ramFreeGB  = [math]::Round($os.FreePhysicalMemory/1MB, 2)
  L ("RAM_TOTAL_GB=" + $ramTotalGB)
  L ("RAM_FREE_GB=" + $ramFreeGB)
  L ("RAM_USED_PCT=" + [math]::Round(100*($ramTotalGB-$ramFreeGB)/$ramTotalGB,1))
} catch { L 'RAM=ERR' }

try {
  $c = Get-PSDrive C
  $freeGB = [math]::Round($c.Free/1GB, 2)
  $totalGB = [math]::Round(($c.Free+$c.Used)/1GB, 2)
  L ("DISK_C_TOTAL_GB=" + $totalGB)
  L ("DISK_C_FREE_GB=" + $freeGB)
  L ("DISK_C_FREE_PCT=" + [math]::Round(100*$c.Free/($c.Free+$c.Used),1))
} catch { L 'DISK_C=ERR' }

try {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
  L ("CPU_PERCENT=" + $cpu)
} catch { L 'CPU=ERR' }

try {
  $diskCtr = Get-Counter '\PhysicalDisk(_Total)\% Disk Time','\PhysicalDisk(_Total)\Disk Bytes/sec' -ErrorAction SilentlyContinue
  if ($diskCtr) {
    foreach ($s in $diskCtr.CounterSamples) {
      if ($s.Path -like '*% Disk Time*') { L ("DISK_ACTIVE_PERCENT=" + [math]::Round($s.CookedValue,1)) }
      if ($s.Path -like '*Disk Bytes/sec*') { L ("DISK_BYTES_PER_SEC=" + [math]::Round($s.CookedValue,0)) }
    }
  } else { L 'DISK_IO=unavailable' }
} catch { L 'DISK_IO=ERR' }

# Top process by WorkingSet (compact)
try {
  $top = Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 5
  $i=0
  foreach ($p in $top) {
    $i++
    L ("TOP_RAM_" + $i + "=" + $p.ProcessName + " pid=" + $p.Id + " MB=" + [math]::Round($p.WorkingSet64/1MB,0))
  }
} catch {}

# --- Phone Link / Enlace Movil discovery ---
L '--- PHONE_LINK_DISCOVERY ---'
$phonePkgs = @()
try {
  $phonePkgs = @(Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match 'Phone|YourPhone|PhoneExperience|MobileConnect' -or
    $_.PackageFullName -match 'Phone|YourPhone|PhoneExperience'
  })
} catch {
  try {
    $phonePkgs = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {
      $_.Name -match 'Phone|YourPhone|PhoneExperience|MobileConnect'
    })
  } catch {}
}

if ($phonePkgs.Count -eq 0) {
  L 'PHONE_LINK_PACKAGE=NONE_FOUND'
} else {
  foreach ($pkg in $phonePkgs) {
    L ("PHONE_PKG_NAME=" + $pkg.Name)
    L ("PHONE_PKG_FULL=" + $pkg.PackageFullName)
    L ("PHONE_PKG_PUBLISHER=" + $pkg.Publisher)
    L ("PHONE_PKG_LOCATION=" + $pkg.InstallLocation)
    L ("PHONE_PKG_STATUS=" + $pkg.Status)
  }
}

$prov = @()
try {
  $prov = @(Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -match 'Phone|YourPhone|PhoneExperience' -or $_.PackageName -match 'Phone|YourPhone'
  })
} catch { L ("PROVISIONED_QUERY=" + $_.Exception.Message) }

if ($prov.Count -eq 0) { L 'PHONE_PROVISIONED=NONE' }
else {
  foreach ($p in $prov) {
    L ("PHONE_PROVISIONED_NAME=" + $p.DisplayName)
    L ("PHONE_PROVISIONED_PACKAGE=" + $p.PackageName)
  }
}

$phoneProcs = @('PhoneExperienceHost','YourPhone','PhoneExperience','YourPhoneServer','YourPhoneApp')
$procAlive = $false
foreach ($n in $phoneProcs) {
  $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
  if ($ps.Count -gt 0) {
    $procAlive = $true
    L ("PHONE_PROC=" + $n + " COUNT=" + $ps.Count)
  }
}
if (-not $procAlive) { L 'PHONE_PROC=NONE' }

# --- Uninstall ---
L '--- PHONE_LINK_UNINSTALL ---'
$uninstalled = 0
$blocked = $false
$blockReason = ''

foreach ($pkg in $phonePkgs) {
  try {
    L ("REMOVE_APPX=" + $pkg.PackageFullName)
    Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
    $uninstalled++
    L ("REMOVE_APPX_RESULT=OK name=" + $pkg.Name)
  } catch {
    try {
      Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop
      $uninstalled++
      L ("REMOVE_APPX_ALLUSERS_RESULT=OK name=" + $pkg.Name)
    } catch {
      $blocked = $true
      $blockReason = $_.Exception.Message
      L ("REMOVE_APPX_FAIL=" + $pkg.Name + " err=" + $blockReason)
    }
  }
}

foreach ($p in $prov) {
  try {
    L ("REMOVE_PROVISIONED=" + $p.PackageName)
    Remove-AppxProvisionedPackage -Online -PackageName $p.PackageName -ErrorAction Stop | Out-Null
    $uninstalled++
    L ("REMOVE_PROVISIONED_RESULT=OK")
  } catch {
    $blocked = $true
    $blockReason = $_.Exception.Message
    L ("REMOVE_PROVISIONED_FAIL=" + $blockReason)
  }
}

# Stop leftover processes (safe)
foreach ($n in $phoneProcs) {
  Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
    try {
      Stop-Process -Id $_.Id -Force -ErrorAction Stop
      L ("PHONE_PROC_KILLED=" + $n + " pid=" + $_.Id)
    } catch {
      L ("PHONE_PROC_KILL_FAIL=" + $n + " " + $_.Exception.Message)
    }
  }
}

Start-Sleep -Seconds 3

# --- Verify ---
L '--- PHONE_LINK_VERIFY ---'
$remain = @()
try {
  $remain = @(Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match 'Phone|YourPhone|PhoneExperience|MobileConnect'
  })
} catch {
  $remain = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match 'Phone|YourPhone|PhoneExperience|MobileConnect'
  })
}
L ("PHONE_LINK_PRESENT=" + ($remain.Count -gt 0))
if ($remain.Count -gt 0) {
  foreach ($r in $remain) { L ("PHONE_REMAINING=" + $r.PackageFullName) }
}

$procAlive2 = $false
foreach ($n in $phoneProcs) {
  if (@(Get-Process -Name $n -ErrorAction SilentlyContinue).Count -gt 0) { $procAlive2 = $true; L ("PHONE_PROC_STILL=" + $n) }
}
L ("PHONE_LINK_PROCESS=" + $procAlive2)

if ($blocked -and $uninstalled -eq 0) {
  L ("PHONE_LINK_UNINSTALL_BLOCKED=" + $blockReason)
} elseif ($remain.Count -eq 0 -and -not $procAlive2) {
  L 'PHONE_LINK_UNINSTALL=SUCCESS'
} elseif ($uninstalled -gt 0) {
  L ("PHONE_LINK_UNINSTALL=PARTIAL removed=" + $uninstalled + " remaining=" + $remain.Count)
} else {
  L 'PHONE_LINK_UNINSTALL=NOOP'
}

# --- Post metrics ---
L '--- POST_METRICS ---'
try {
  $os = Get-CimInstance Win32_OperatingSystem
  L ("POST_RAM_FREE_GB=" + [math]::Round($os.FreePhysicalMemory/1MB, 2))
} catch {}
try {
  $c = Get-PSDrive C
  L ("POST_DISK_C_FREE_GB=" + [math]::Round($c.Free/1GB, 2))
  L ("POST_DISK_C_FREE_PCT=" + [math]::Round(100*$c.Free/($c.Free+$c.Used),1))
} catch {}
try {
  $cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
  L ("POST_CPU_PERCENT=" + $cpu)
} catch {}
try {
  $diskCtr = Get-Counter '\PhysicalDisk(_Total)\% Disk Time' -ErrorAction SilentlyContinue
  if ($diskCtr) { L ("POST_DISK_ACTIVE_PERCENT=" + [math]::Round($diskCtr.CounterSamples[0].CookedValue,1)) }
} catch {}

# ARIA compact status only (no state.json dump)
L '--- ARIA_COMPACT ---'
try {
  $stPath = 'D:\ARIA-Windows-Agent\Logs\status.json'
  if (Test-Path $stPath) {
    $st = Get-Content -Raw $stPath | ConvertFrom-Json
    L ("ARIA_STATE=" + $st.state)
    L ("ARIA_AGENT_PID=" + $st.agent_pid)
    L ("ARIA_WATCHDOG_PID=" + $st.watchdog_pid)
    L ("ARIA_SHA=" + $st.runtime_source_sha)
  } else { L 'ARIA_STATUS=missing' }
} catch { L 'ARIA_STATUS=ERR' }

try {
  $wd = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*run-agent.ps1*' })
  $ag = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*aria-agent.js*' })
  L ("ARIA_LIVE_WATCHDOG=" + $wd.Count)
  L ("ARIA_LIVE_AGENT=" + $ag.Count)
} catch { L 'ARIA_LIVE=ERR' }

L '=== END ==='
exit 0
