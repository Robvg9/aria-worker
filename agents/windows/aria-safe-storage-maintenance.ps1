$ErrorActionPreference = 'Continue'
$out = New-Object System.Collections.Generic.List[string]
function L([string]$s){ $out.Add($s); Write-Host $s }

L '=== ARIA SAFE STORAGE MAINTENANCE ==='
L ("HOST=" + $env:COMPUTERNAME)
L ("USER=" + $env:USERNAME)

function Get-CFreeGB {
  try { $c=Get-PSDrive C; return [math]::Round($c.Free/1GB,2) } catch { return $null }
}
function Get-CFreePct {
  try { $c=Get-PSDrive C; return [math]::Round(100*$c.Free/($c.Free+$c.Used),1) } catch { return $null }
}

$preFree=Get-CFreeGB; $prePct=Get-CFreePct
L ("PRE_C_FREE_GB=" + $preFree)
L ("PRE_C_FREE_PCT=" + $prePct)

$deletedBytes=[int64]0
$deletedItems=0

function Remove-OldTempItems([string]$Path,[int]$Days=1){
  if(-not(Test-Path $Path)){ return }
  $cutoff=(Get-Date).AddDays(-$Days)
  try {
    Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $cutoff } | ForEach-Object {
      try {
        $size=if($_.PSIsContainer){
          (Get-ChildItem -LiteralPath $_.FullName -File -Force -Recurse -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
        } else { $_.Length }
        Remove-Item -LiteralPath $_.FullName -Force -Recurse -ErrorAction Stop
        $script:deletedItems++
        if($size){ $script:deletedBytes += [int64]$size }
      } catch {}
    }
  } catch {}
}

# Only disposable temporary data. Do not touch Windows system files, Defender,
# Windows Update databases, Runner, Ollama, Node, ARIA runtime or user documents.
L 'CLEAN_USER_TEMP=START'
Remove-OldTempItems -Path $env:TEMP -Days 1
L 'CLEAN_USER_TEMP=DONE'

L 'CLEAN_WINDOWS_TEMP=START'
Remove-OldTempItems -Path 'C:\Windows\Temp' -Days 1
L 'CLEAN_WINDOWS_TEMP=DONE'

# Compact cache targets that are disposable when present. Never stop applications;
# locked files are simply skipped.
$cacheRoots=@(
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Cache'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data\Default\Code Cache'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Cache'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Default\Code Cache')
)
foreach($root in $cacheRoots){
  if(Test-Path $root){
    L ("CACHE_TARGET=" + $root)
    Remove-OldTempItems -Path $root -Days 2
  }
}

$postFree=Get-CFreeGB; $postPct=Get-CFreePct
$freed=if($preFree -ne $null -and $postFree -ne $null){[math]::Round($postFree-$preFree,2)}else{$null}
L ("POST_C_FREE_GB=" + $postFree)
L ("POST_C_FREE_PCT=" + $postPct)
L ("FREED_GB=" + $freed)
L ("ITEMS_REMOVED=" + $deletedItems)
L ("BYTES_REMOVED_GB=" + [math]::Round($deletedBytes/1GB,2))

# Large personal files are discovered only, never moved or deleted automatically.
L '--- LARGE_FILE_CANDIDATES (INFO ONLY) ---'
$roots=@(
  (Join-Path $env:USERPROFILE 'Downloads'),
  (Join-Path $env:USERPROFILE 'Desktop'),
  (Join-Path $env:USERPROFILE 'Videos')
)
try {
  foreach($root in $roots){
    if(Test-Path $root){
      Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction SilentlyContinue |
        Where-Object { $_.Length -ge 500MB } |
        Sort-Object Length -Descending |
        Select-Object -First 10 |
        ForEach-Object { L ("LARGE_FILE=" + $_.FullName + " GB=" + [math]::Round($_.Length/1GB,2)) }
    }
  }
} catch {}

L 'RESULT=SAFE_CLEANUP_COMPLETE'
L 'POLICY=NO_PERSONAL_MOVE_NO_SYSTEM_DELETE'
L '=== END ==='
exit 0
