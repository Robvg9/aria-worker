$ErrorActionPreference = 'Continue'
function L([string]$s){ Write-Host $s }

L '=== ROBVG_PHONE_LINK_CLEANUP ==='
L ("HOST=" + $env:COMPUTERNAME)
L ("USER=" + $env:USERNAME)

# Compact metrics only
try {
  $os = Get-CimInstance Win32_OperatingSystem
  L ("RAM_TOTAL_GB=" + [math]::Round($os.TotalVisibleMemorySize/1MB,2))
  L ("RAM_FREE_GB=" + [math]::Round($os.FreePhysicalMemory/1MB,2))
} catch {}
try {
  $c = Get-PSDrive C
  L ("DISK_C_FREE_GB=" + [math]::Round($c.Free/1GB,2))
  L ("DISK_C_FREE_PCT=" + [math]::Round(100*$c.Free/($c.Free+$c.Used),1))
} catch {}
try { L ("CPU_PERCENT=" + (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average) } catch {}
try {
  $diskCtr = Get-Counter '\PhysicalDisk(_Total)\% Disk Time' -ErrorAction SilentlyContinue
  if ($diskCtr) { L ("DISK_ACTIVE_PERCENT=" + [math]::Round($diskCtr.CounterSamples[0].CookedValue,1)) }
} catch {}

# Discovery: narrow match (YourPhone / PhoneExperience only)
$phonePkgs = @()
try {
  $phonePkgs = @(Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'Microsoft.YourPhone' -or $_.Name -match 'PhoneExperienceHost|Microsoft\.YourPhone'
  })
} catch {
  $phonePkgs = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'Microsoft.YourPhone' -or $_.Name -match 'PhoneExperience'
  })
}
L ("PHONE_LINK_PACKAGE_COUNT=" + $phonePkgs.Count)
foreach ($pkg in $phonePkgs) {
  L ("PHONE_LINK_NAME=" + $pkg.Name)
  L ("PHONE_LINK_FULL=" + $pkg.PackageFullName)
}

$prov = @()
try {
  $prov = @(Get-AppxProvisionedPackage -Online -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -match 'Your Phone|Phone Link|PhoneExperience' -or $_.PackageName -match 'YourPhone|PhoneExperience'
  })
} catch {}
L ("PHONE_LINK_PROVISIONED_COUNT=" + $prov.Count)
foreach ($p in $prov) { L ("PHONE_LINK_PROVISIONED=" + $p.PackageName) }

$procNames = @('PhoneExperienceHost','YourPhone','YourPhoneServer','YourPhoneApp')
$procCount = 0
foreach ($n in $procNames) {
  $ps = @(Get-Process -Name $n -ErrorAction SilentlyContinue)
  $procCount += $ps.Count
  foreach ($pr in $ps) {
    try { Stop-Process -Id $pr.Id -Force -ErrorAction Stop; L ("PHONE_PROC_KILLED=" + $n + " pid=" + $pr.Id) } catch {}
  }
}
L ("PHONE_LINK_PROCESS_PRE=" + $procCount)

$removed = 0
$blocked = $null

# Prefer AllUsers first
foreach ($pkg in $phonePkgs) {
  $ok = $false
  try {
    Remove-AppxPackage -Package $pkg.PackageFullName -AllUsers -ErrorAction Stop
    L ("REMOVE_APPX_ALLUSERS=OK full=" + $pkg.PackageFullName)
    $removed++; $ok = $true
  } catch {
    L ("REMOVE_APPX_ALLUSERS_FAIL=" + $_.Exception.Message)
  }
  if (-not $ok) {
    try {
      Remove-AppxPackage -Package $pkg.PackageFullName -ErrorAction Stop
      L ("REMOVE_APPX=OK full=" + $pkg.PackageFullName)
      $removed++
    } catch {
      $blocked = $_.Exception.Message
      L ("REMOVE_APPX_FAIL=" + $blocked)
    }
  }
}

foreach ($p in $prov) {
  try {
    Remove-AppxProvisionedPackage -Online -PackageName $p.PackageName -ErrorAction Stop | Out-Null
    L ("REMOVE_PROVISIONED=OK package=" + $p.PackageName)
    $removed++
  } catch {
    $blocked = $_.Exception.Message
    L ("REMOVE_PROVISIONED_FAIL=" + $blocked)
  }
}

Start-Sleep -Seconds 2

$remain = @()
try {
  $remain = @(Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'Microsoft.YourPhone' -or $_.Name -match 'PhoneExperience'
  })
} catch {
  $remain = @(Get-AppxPackage -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'Microsoft.YourPhone' -or $_.Name -match 'PhoneExperience'
  })
}
$procLeft = 0
foreach ($n in $procNames) { $procLeft += @(Get-Process -Name $n -ErrorAction SilentlyContinue).Count }

L ("PHONE_LINK_PRESENT=" + ($remain.Count -gt 0))
L ("PHONE_LINK_PROCESS=" + ($procLeft -gt 0))
foreach ($r in $remain) { L ("PHONE_REMAINING=" + $r.PackageFullName) }

if ($remain.Count -eq 0 -and $procLeft -eq 0) {
  L 'PHONE_LINK_UNINSTALL=SUCCESS'
} elseif ($removed -gt 0) {
  L ("PHONE_LINK_UNINSTALL=PARTIAL removed=" + $removed)
  if ($blocked) { L ("PHONE_LINK_UNINSTALL_BLOCKED=" + $blocked) }
} elseif ($blocked) {
  L ("PHONE_LINK_UNINSTALL_BLOCKED=" + $blocked)
} else {
  L 'PHONE_LINK_UNINSTALL=NOOP'
}

try {
  $c = Get-PSDrive C
  L ("POST_DISK_C_FREE_GB=" + [math]::Round($c.Free/1GB,2))
  L ("POST_DISK_C_FREE_PCT=" + [math]::Round(100*$c.Free/($c.Free+$c.Used),1))
} catch {}
try {
  $os = Get-CimInstance Win32_OperatingSystem
  L ("POST_RAM_FREE_GB=" + [math]::Round($os.FreePhysicalMemory/1MB,2))
} catch {}
try {
  $st = Get-Content -Raw 'D:\ARIA-Windows-Agent\Logs\status.json' | ConvertFrom-Json
  L ("ARIA_STATE=" + $st.state)
  L ("ARIA_AGENT_PID=" + $st.agent_pid)
  L ("ARIA_WATCHDOG_PID=" + $st.watchdog_pid)
} catch { L 'ARIA_STATE=err' }

L '=== END ==='
exit 0
