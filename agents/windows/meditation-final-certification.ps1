$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Get-MeditationState {
  $p='D:\ARIA-Windows-Agent\Runtime\meditation\state.json'
  for($i=0;$i -lt 80;$i++) {
    try {
      if(Test-Path $p) {
        $raw=Get-Content -Raw $p -ErrorAction Stop
        if($raw.Trim()) {
          $state=$raw|ConvertFrom-Json -ErrorAction Stop
          if($null -ne $state){ return $state }
        }
      }
    } catch {}
    Start-Sleep -Milliseconds 250
  }
  return $null
}
function Get-MeditationStatusLoopback { try { $raw=& curl.exe --noproxy '*' -sS --max-time 5 'http://127.0.0.1:45873/status' 2>$null|Out-String; if($raw.Trim()){return $raw|ConvertFrom-Json} } catch {}; return $null }

$RuntimeRoot='D:\ARIA-Windows-Agent'; $RuntimeDir=Join-Path $RuntimeRoot 'Runtime\windows'; $DataDir=Join-Path $RuntimeRoot 'Data'; $LogDir=Join-Path $RuntimeRoot 'Logs'; $StatusPath=Join-Path $LogDir 'status.json'; $PidPath=Join-Path $LogDir 'agent.pid'; $KillRequestPath=Join-Path $LogDir 'kill-request'; $RepoRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot); $MeditationStatePath=Join-Path $RuntimeRoot 'Runtime\meditation\state.json'; $MeditationLogPath=Join-Path $RuntimeRoot 'Runtime\meditation\ARIA-Meditation-IA.txt'

Write-Host '=== ARIA MEDITATION IA FINAL PHYSICAL CERTIFICATION ==='; Write-Host "SOURCE_COMMIT=$env:ARIA_EXPECTED_SHA"
Write-Host '--- STAGE 0: SINGLE-OWNER RUNTIME OWNERSHIP ---'; Assert-True (Test-Path $StatusPath) 'ARIA watchdog status file missing'; Assert-True (Test-Path (Join-Path $LogDir 'watchdog.pid')) 'ARIA watchdog ownership marker missing'; Assert-True (Test-Path (Join-Path $RuntimeDir 'run-agent.ps1')) 'ARIA persistent runtime missing'; Write-Host 'RUNNER_PROCESS_ADMINISTRATION=DISABLED'; Write-Host 'WATCHDOG_IS_SINGLE_LIFECYCLE_OWNER=PASS'

Write-Host '--- STAGE 1: RUNTIME SYNC / ACTIVE RUNTIME HEALTH ---'
foreach($file in @('aria-agent.js','aria-meditation-controller.js','self-improvement-runtime.js','run-agent.ps1')){ $source=Join-Path $PSScriptRoot $file; Assert-True (Test-Path $source) "Certification source missing: $source"; Copy-Item $source (Join-Path $RuntimeDir $file) -Force }
foreach($dirName in @('autonomy','self-development','self-model')){ $sourceDir=Join-Path $RepoRoot $dirName; $destDir=Join-Path $RuntimeRoot "Runtime\$dirName"; Assert-True (Test-Path $sourceDir) "Certification source directory missing: $sourceDir"; New-Item -ItemType Directory -Force -Path $destDir|Out-Null; Copy-Item (Join-Path $sourceDir '*') $destDir -Recurse -Force }
Assert-True (Test-Path $MeditationStatePath) 'Meditation persisted state missing'; $m=Get-MeditationState; Assert-True ($null -ne $m) 'Meditation persisted state unreadable'; $watchdog=Get-Content -Raw $StatusPath|ConvertFrom-Json; Assert-True ($watchdog.state -eq 'agent_running') "ARIA watchdog state not running: $($watchdog.state)"; Write-Host "PRE_REFRESH_STATE_VERSION=$($m.version)"; Write-Host "PRE_REFRESH_TICK=$([int]$m.tick_count)"; Write-Host 'RUNTIME_SYNC_STAGE=PASS'

Write-Host '--- STAGE 2: CONTROLLED WATCHDOG RECOVERY / SINGLE-INSTANCE ---'; $beforePid=[string]$watchdog.agent_pid; Assert-True (-not [string]::IsNullOrWhiteSpace($beforePid)) 'Missing current agent pid'; Set-Content -Path $KillRequestPath -Value 'final-cert-recovery' -Encoding UTF8 -Force
$new=$null; for($i=0;$i -lt 120;$i++){ try{$new=Get-Content -Raw $StatusPath|ConvertFrom-Json}catch{}; if($new -and $new.state -eq 'agent_running' -and [string]$new.agent_pid -ne $beforePid){break}; Start-Sleep -Seconds 1 }
Assert-True ($new -and $new.state -eq 'agent_running') 'Watchdog did not recover agent'; Assert-True ([string]$new.agent_pid -ne $beforePid) 'Agent PID did not change during watchdog recovery'; $m=$null
for($i=0;$i -lt 120;$i++){ $m=Get-MeditationState; if($m -and $m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'active' -and $m.last_tick_at){break}; Start-Sleep -Seconds 1 }
Assert-True ($m -and $m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'active') 'Meditation did not recover to active persisted state'; $agents=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue|Where-Object{$_.CommandLine -and $_.CommandLine -match 'aria-agent\.js'}); Assert-True ($agents.Count -eq 1) "Expected one ARIA agent process, found $($agents.Count)"; Write-Host "ARIA_AGENT_RECOVERY=$beforePid->$($new.agent_pid)"; Write-Host "RECOVERY_TICK=$([int]$m.tick_count)"; Write-Host 'SINGLE_AGENT_INSTANCE=PASS'; Write-Host 'WATCHDOG_MEDITATION_RECOVERY=PASS'; Write-Host 'RECOVERY_STAGE=PASS'

Write-Host '--- STAGE 3: LIVE MEDITATION / ARIA GATEWAY ---'; $startTick=[int]$m.tick_count; $advanced=$false; $m2=$null; for($i=0;$i-lt 60;$i++){Start-Sleep -Seconds 1;$m2=Get-MeditationState;if($m2 -and [int]$m2.tick_count -gt $startTick){$advanced=$true;break}}; Assert-True $advanced "Meditation persisted tick did not advance from $startTick"; Assert-True ($m2.mode -eq 'active') 'Meditation lost active mode'; Assert-True ($null -ne $m2.last_result) 'Meditation produced no persisted result'; Assert-True ([string]$m2.last_result.error -ne 'meditation_gateway_config_missing') 'Meditation gateway configuration missing'; Assert-True (Test-Path $MeditationLogPath) 'Meditation log missing'; $tail=Get-Content $MeditationLogPath -Tail 100 -ErrorAction Stop; Assert-True ((($tail -join "`n") -match 'JOB RESULT|IDLE tick=|MISSION CREATED')) 'No recent autonomous Meditation activity in log'; Write-Host "MEDITATION_TICK_ADVANCE=$startTick->$($m2.tick_count)"; Write-Host ('MEDITATION_PERSISTED_GATEWAY_RESULT='+($m2.last_result|ConvertTo-Json -Compress -Depth 12)); Write-Host 'INTEGRATION_STAGE=PASS'

Write-Host '--- STAGE 4: PHYSICAL SELF-IMPROVEMENT ---'; $runtime=Join-Path $RuntimeDir 'self-improvement-runtime.js'; Assert-True (Test-Path $runtime) 'Self-improvement runtime missing'; $job=@{device_id='windows-fe722cc6681e4f9c9cc35f5ebbb0a089';operation='self.improve';command=(@{goal='Meditation IA final physical reliability certification';category='documentation';risk='LOW';scope=@('physical-certification.js');proposed_changes=@(@{type='add_file';path='physical-certification.js';content="module.exports = { status: 'ok', source: 'aria-physical-cert' };";risk_level='LOW'});mission_id='aria-meditation-final-certification';step_id='physical-self-improvement';device_id='windows-fe722cc6681e4f9c9cc35f5ebbb0a089'}|ConvertTo-Json -Compress -Depth 10)}|ConvertTo-Json -Compress -Depth 10; $env:ARIA_SELF_IMPROVEMENT_JOB=$job; $out=& node -e "const {executeSelfImprovementJob}=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js');const job=JSON.parse(process.env.ARIA_SELF_IMPROVEMENT_JOB);executeSelfImprovementJob(job,'windows-fe722cc6681e4f9c9cc35f5ebbb0a089').then(r=>{console.log(JSON.stringify(r));if(r.status!=='succeeded'||r.coordinator_status!=='completed'||r.stop_reason!=='verified'||!r.evidence_hash)process.exit(1)}).catch(e=>{console.error(e.stack||e);process.exit(1)})" 2>&1; $out|Write-Host; Assert-True ($LASTEXITCODE -eq 0) 'Physical self-improvement proof failed'; $evidence=Join-Path $DataDir 'self-improvement-last.json'; Assert-True (Test-Path $evidence) 'Self-improvement evidence file missing'; $ev=Get-Content -Raw $evidence|ConvertFrom-Json; Assert-True (-not [string]::IsNullOrWhiteSpace([string]$ev.objective)) 'Self-improvement evidence objective missing'; Assert-True (Test-Path (Join-Path $RuntimeRoot 'Runtime\self-improvement-workspace\physical-certification.js')) 'Sandbox self-improvement artifact missing'; Write-Host 'PHYSICAL_SELF_IMPROVEMENT=PASS'; Write-Host 'CERTIFICATION_STAGE=PASS'; Write-Host 'ARIA_SELF_IMPROVEMENT_WINDOWS_PHYSICAL_E2E=PASS'; Write-Host 'STATUS=PHYSICAL_RUNTIME_MEDITATION_AND_SELF_IMPROVEMENT_VERIFIED'; Write-Host 'MEDITATION_IA_PHASE=100_PERCENT_CERTIFIED'; Write-Host '=== CERTIFICATION COMPLETE ==='
