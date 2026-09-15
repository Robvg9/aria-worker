$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.Generic.List[string]
$removed = New-Object System.Collections.Generic.List[object]
function L([string]$s){ $out.Add($s); Write-Host $s }
function FreeGB { try { [math]::Round((Get-PSDrive C).Free/1GB,2) } catch { $null } }
function FreeBytes { try { [int64](Get-PSDrive C).Free } catch { [int64]0 } }
function Record([string]$kind,[string]$path,[int64]$bytes){ $removed.Add([pscustomobject]@{kind=$kind;path=$path;bytes=$bytes}) }

$TargetGB = 6.0
$TargetBytes = [int64]($TargetGB * 1GB)
$PreFreeBytes = FreeBytes

L '=== ARIA STORAGE RECOVERY MISSION ==='
L ("HOST=" + $env:COMPUTERNAME)
L ("USER=" + $env:USERNAME)
L ("TARGET_FREE_GB=" + $TargetGB)
L ("PRE_C_FREE_GB=" + (FreeGB))

# Only disposable locations. Personal files and protected Windows/application data are excluded.
$targets = @(
  @('USER_TEMP', $env:TEMP, 1),
  @('WINDOWS_TEMP', 'C:\Windows\Temp', 1),
  @('EDGE_CACHE', (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Cache'), 2),
  @('EDGE_CODECACHE', (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Code Cache'), 2),
  @('CHROME_CACHE', (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Cache'), 2),
  @('CHROME_CODECACHE', (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Code Cache'), 2),
  @('WER_ARCHIVE', 'C:\ProgramData\Microsoft\Windows\WER\ReportArchive', 7),
  @('WER_QUEUE', 'C:\ProgramData\Microsoft\Windows\WER\ReportQueue', 7),
  @('USER_CRASHDUMPS', (Join-Path $env:LOCALAPPDATA 'CrashDumps'), 7),
  @('INET_CACHE', (Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\INetCache'), 2)
)

foreach($entry in $targets){
  $kind=$entry[0]; $root=$entry[1]; $days=[int]$entry[2]
  if([string]::IsNullOrWhiteSpace($root) -or -not(Test-Path -LiteralPath $root)){ continue }
  L ("SCAN_TARGET=" + $kind)
  try {
    $cutoff=(Get-Date).AddDays(-$days)
    Get-ChildItem -LiteralPath $root -Force -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $cutoff } |
      Sort-Object Length -Descending |
      ForEach-Object {
        if((FreeBytes - $PreFreeBytes) -ge $TargetBytes){ return }
        try {
          $size=[int64]$_.Length
          Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop
          Record $kind $_.FullName $size
        } catch {}
      }
  } catch {}
}

# Recycle Bin is explicitly disposable user-deleted content.
if((FreeBytes - $PreFreeBytes) -lt $TargetBytes){
  try {
    $before=FreeBytes
    Clear-RecycleBin -DriveLetter C -Force -ErrorAction SilentlyContinue
    $gain=[int64]([math]::Max(0,(FreeBytes-$before)))
    Record 'RECYCLE_BIN' 'C:\$Recycle.Bin' $gain
    L 'RECYCLE_BIN=PROCESSED'
  } catch {}
}

# Last-resort safe Windows component cleanup if disposable data was not enough.
if((FreeBytes - $PreFreeBytes) -lt $TargetBytes){
  try {
    L 'DISM_COMPONENT_CLEANUP=START'
    $dism=Start-Process -FilePath 'dism.exe' -ArgumentList '/Online','/Cleanup-Image','/StartComponentCleanup' -Wait -PassThru -WindowStyle Hidden
    L ('DISM_COMPONENT_CLEANUP_EXIT=' + $dism.ExitCode)
  } catch {
    L ('DISM_COMPONENT_CLEANUP_ERROR=' + $_.Exception.Message)
  }
}

$PostFreeBytes=FreeBytes
$FreedBytes=[int64]([math]::Max(0,$PostFreeBytes-$PreFreeBytes))
L ("POST_C_FREE_GB=" + (FreeGB))
L ("FREED_GB=" + [math]::Round($FreedBytes/1GB,2))
L ("TARGET_MET=" + ($FreedBytes -ge $TargetBytes))
L ("FILES_REMOVED=" + $removed.Count)

L '--- CLEANUP_SUMMARY ---'
$summary = $removed | Group-Object kind | ForEach-Object {
  [pscustomobject]@{ kind=$_.Name; items=$_.Count; gb=[math]::Round((($_.Group | Measure-Object bytes -Sum).Sum)/1GB,2) }
}
$summary | ConvertTo-Json -Compress

L '--- LARGEST_REMOVED ---'
$removed | Sort-Object bytes -Descending | Select-Object -First 30 | ForEach-Object {
  'REMOVED|' + $_.kind + '|' + [math]::Round($_.bytes/1GB,3) + 'GB|' + $_.path
}

L 'POLICY=TEMP_CACHE_WER_CRASHDUMPS_RECYCLE_BIN_PLUS_COMPONENT_CLEANUP'
L 'PERSONAL_FILES=NOT_TOUCHED'
L 'CRITICAL_WINDOWS_DATA=NOT_TOUCHED'
L 'TOTALCOMMANDER=NOT_USED'
L '=== END ==='
exit 0
