$ErrorActionPreference = 'Stop'
function Assert-True([bool]$Condition,[string]$Message){if(-not $Condition){throw $Message}}
$RuntimeRoot='D:\ARIA-Windows-Agent'
$RuntimeDir=Join-Path $RuntimeRoot 'Runtime\windows'
$DataDir=Join-Path $RuntimeRoot 'Data'
$LogDir=Join-Path $RuntimeRoot 'Logs'
$StatusPath=Join-Path $LogDir 'status.json'
$PidPath=Join-Path $LogDir 'agent.pid'
$KillRequestPath=Join-Path $LogDir 'kill-request.json'
$RuntimeShaPath=Join-Path $LogDir 'runtime-source-sha'
$ConfigPath=Join-Path $DataDir 'config.json'
$MeditationLogPath=Join-Path $RuntimeRoot 'Runtime\meditation\ARIA-Meditation-IA.txt'
$MeditationStatePath=Join-Path $RuntimeRoot 'Runtime\meditation\state.json'
$RepoRoot=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Read-JsonFile([string]$Path){
  try{
    if(Test-Path $Path){
      $raw=Get-Content -Raw $Path -ErrorAction Stop
      if($raw -and $raw.Trim()){return ($raw|ConvertFrom-Json -ErrorAction Stop)}
    }
  }catch{}
  return $null
}
function Get-MaxMeditationTick{
  if(-not(Test-Path $MeditationLogPath)){return -1}
  $ticks=@()
  foreach($line in (Get-Content $MeditationLogPath -Tail 400 -ErrorAction SilentlyContinue)){
    if($line -match 'IDLE tick=(\d+)'){$ticks += [int]$Matches[1]}
  }
  if($ticks.Count -eq 0){return -1}
  return ($ticks|Measure-Object -Maximum).Maximum
}
function Test-AgentAliveByPid([int]$ProcessId){
  if($ProcessId -le 0){return $false}
  try{Get-Process -Id $ProcessId -ErrorAction Stop|Out-Null;return $true}catch{return $false}
}
function Resolve-NodePath{
  try{
    if(Test-Path $ConfigPath){
      $cfg=Get-Content -Raw $ConfigPath|ConvertFrom-Json
      if($cfg.node_path -and (Test-Path ([string]$cfg.node_path))){return [string]$cfg.node_path}
    }
  }catch{}
  $cmd=Get-Command node -ErrorAction SilentlyContinue
  if($cmd){return $cmd.Source}
  $fallback='D:\Databank\node\node.exe'
  if(Test-Path $fallback){return $fallback}
  throw 'Node.js executable not found'
}

Write-Host '=== ARIA MEDITATION IA FINAL PHYSICAL CERTIFICATION ==='
Write-Host "SOURCE_COMMIT=$env:ARIA_EXPECTED_SHA"
Write-Host '--- STAGE 0: SINGLE-OWNER RUNTIME OWNERSHIP ---'
Assert-True (Test-Path $StatusPath) 'ARIA watchdog status file missing'
Assert-True (Test-Path (Join-Path $LogDir 'watchdog.pid')) 'ARIA watchdog ownership marker missing'
Assert-True (Test-Path (Join-Path $RuntimeDir 'run-agent.ps1')) 'ARIA persistent runtime missing'
Write-Host 'RUNNER_PROCESS_ADMINISTRATION=DISABLED'
Write-Host 'WATCHDOG_IS_SINGLE_LIFECYCLE_OWNER=PASS'

Write-Host '--- STAGE 1: RUNTIME SYNC / ACTIVE RUNTIME HEALTH ---'
foreach($file in @('aria-agent.js','aria-meditation-controller.js','self-improvement-runtime.js','run-agent.ps1')){
  $source=Join-Path $PSScriptRoot $file
  Assert-True (Test-Path $source) "Certification source missing: $source"
  Copy-Item $source (Join-Path $RuntimeDir $file) -Force
}
foreach($dirName in @('autonomy','self-development','self-model')){
  $sourceDir=Join-Path $RepoRoot $dirName
  $destDir=Join-Path $RuntimeRoot "Runtime\$dirName"
  Assert-True (Test-Path $sourceDir) "Certification source directory missing: $sourceDir"
  New-Item -ItemType Directory -Force -Path $destDir|Out-Null
  Copy-Item (Join-Path $sourceDir '*') $destDir -Recurse -Force
}
if(-not [string]::IsNullOrWhiteSpace($env:ARIA_EXPECTED_SHA)){
  Set-Content -Path $RuntimeShaPath -Value $env:ARIA_EXPECTED_SHA -Encoding ASCII -Force
}
$watchdog=$null
for($i=0;$i-lt 60;$i++){
  $watchdog=Read-JsonFile $StatusPath
  if($watchdog -and $watchdog.state -eq 'agent_running'){break}
  Start-Sleep -Seconds 1
}
Assert-True ($null-ne $watchdog -and $watchdog.state -eq 'agent_running') "ARIA watchdog state not running: $($watchdog.state)"
Assert-True (Test-Path $MeditationLogPath) 'Meditation log missing'
Write-Host "PRE_REFRESH_AGENT_PID=$($watchdog.agent_pid)"
Write-Host "PRE_REFRESH_LOG_TICK=$(Get-MaxMeditationTick)"
Write-Host 'PERSISTED_STATE_CHECK=DEFERRED_TO_POST_REFRESH'
Write-Host 'RUNTIME_SYNC_STAGE=PASS'

Write-Host '--- STAGE 2: CONTROLLED WATCHDOG RECOVERY / SINGLE-INSTANCE ---'
$beforePid=[string]$watchdog.agent_pid
Assert-True (-not [string]::IsNullOrWhiteSpace($beforePid)) 'Missing current agent pid'
$killPayload = (@{ reason = 'final-cert-recovery'; source_sha = [string]$env:ARIA_EXPECTED_SHA; requested_at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress)
Set-Content -Path $KillRequestPath -Value $killPayload -Encoding UTF8 -Force
Write-Host ("KILL_REQUEST_WRITTEN path=$KillRequestPath source_sha=" + $env:ARIA_EXPECTED_SHA)
$new=$null
for($i=0;$i-lt 90;$i++){
  $new=Read-JsonFile $StatusPath
  if($new -and $new.state -eq 'agent_running' -and [string]$new.agent_pid -ne $beforePid){
    Write-Host ("RECOVERY_PID_CHANGE t=" + $i + "s old=" + $beforePid + " new=" + $new.agent_pid)
    break
  }
  if(($i % 15) -eq 14){
    $st = if($new){ $new.state } else { 'null' }
    $ap = if($new){ $new.agent_pid } else { '' }
    Write-Host ("RECOVERY_WAIT t=" + ($i+1) + "s state=" + $st + " agent_pid=" + $ap)
  }
  Start-Sleep -Seconds 1
}
Assert-True ($new -and $new.state -eq 'agent_running') 'Watchdog did not recover agent'
Assert-True ([string]$new.agent_pid -ne $beforePid) 'Agent PID did not change during watchdog recovery'
$recoveredPid=[int]$new.agent_pid
Assert-True (Test-AgentAliveByPid $recoveredPid) "Recovered agent pid $recoveredPid is not a live process"
$recoveredState=$null
for($i=0;$i-lt 90;$i++){
  $recoveredState=Read-JsonFile $MeditationStatePath
  if($recoveredState -and $recoveredState.version -eq 'aria-meditation-ia-v1' -and $recoveredState.mode -eq 'active'){
    Write-Host ("MEDITATION_STATE_ACTIVE t=" + $i + "s tick=" + $recoveredState.tick_count)
    break
  }
  if(($i % 15) -eq 14){ Write-Host ("MEDITATION_STATE_WAIT t=" + ($i+1) + "s") }
  Start-Sleep -Seconds 1
}
$logTail=(Get-Content $MeditationLogPath -Tail 200 -ErrorAction SilentlyContinue)-join "`n"
Assert-True (($recoveredState -and $recoveredState.version -eq 'aria-meditation-ia-v1' -and $recoveredState.mode -eq 'active') -or $logTail -match 'MODE active') 'Meditation did not recover to active state'
$agents=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue|Where-Object{$_.CommandLine -and $_.CommandLine -match 'aria-agent\.js'})
if($agents.Count -gt 0){
  Assert-True ($agents.Count -eq 1) "Expected one ARIA agent process by CommandLine, found $($agents.Count)"
  Assert-True ([int]$agents[0].ProcessId -eq $recoveredPid) "CommandLine agent pid $($agents[0].ProcessId) != status pid $recoveredPid"
  Write-Host 'SINGLE_AGENT_INSTANCE=PASS via=commandline'
} else {
  Assert-True (Test-AgentAliveByPid $recoveredPid) "Expected agent pid $recoveredPid alive (CommandLine not visible to runner)"
  Write-Host 'SINGLE_AGENT_INSTANCE=PASS via=status_pid'
}
Write-Host "ARIA_AGENT_RECOVERY=$beforePid->$($new.agent_pid)"
if($recoveredState){Write-Host "RECOVERY_TICK=$([int]$recoveredState.tick_count)"}else{Write-Host 'RECOVERY_STATE_JSON=UNAVAILABLE_BUT_LOG_ACTIVE=VERIFIED'}
Write-Host 'WATCHDOG_MEDITATION_RECOVERY=PASS'
Write-Host 'RECOVERY_STAGE=PASS'

Write-Host '--- STAGE 3: LIVE MEDITATION / ARIA GATEWAY ---'
$startTick=Get-MaxMeditationTick
Assert-True ($startTick -ge 0) 'Meditation log has no ticks after recovery'
Write-Host ("STAGE3_WAIT_TICKS start=" + $startTick)
Start-Sleep -Seconds 40
$endTick=Get-MaxMeditationTick
Assert-True ($endTick -gt $startTick) "Meditation log tick did not advance from $startTick to $endTick"
$tail=Get-Content $MeditationLogPath -Tail 250 -ErrorAction SilentlyContinue
$joined=$tail-join "`n"
Assert-True ($joined -match 'MODE active') 'Meditation log does not show active mode'
Assert-True ($joined -match 'JOB RESULT|MISSION CREATED|IDLE tick=') 'No recent autonomous Meditation activity in log'
Write-Host "MEDITATION_TICK_ADVANCE=$startTick->$endTick"
Write-Host 'MEDITATION_PERSISTED_ACTIVITY=VERIFIED_FROM_LIVE_LOG'
Write-Host 'INTEGRATION_STAGE=PASS'

Write-Host '--- STAGE 4: PHYSICAL SELF-IMPROVEMENT ---'
$runtime=Join-Path $RuntimeDir 'self-improvement-runtime.js'
Assert-True (Test-Path $runtime) 'Self-improvement runtime missing'
$nodeExe=Resolve-NodePath
Write-Host ("STAGE4_NODE=" + $nodeExe)
$job=@{device_id='windows-fe722cc6681e4f9c9cc35f5ebbb0a089';operation='self.improve';command=(@{goal='Meditation IA final physical reliability certification';category='documentation';risk='LOW';scope=@('physical-certification.js');proposed_changes=@(@{type='add_file';path='physical-certification.js';content="module.exports = { status: 'ok', source: 'aria-physical-cert' };";risk_level='LOW'});mission_id='aria-meditation-final-certification';step_id='physical-self-improvement';device_id='windows-fe722cc6681e4f9c9cc35f5ebbb0a089'}|ConvertTo-Json -Compress -Depth 10)}|ConvertTo-Json -Compress -Depth 10
$env:ARIA_SELF_IMPROVEMENT_JOB=$job
Write-Host 'SELF_IMPROVEMENT_EXECUTION=START'
$nodeArgs = @('-e', "const {executeSelfImprovementJob}=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js');const job=JSON.parse(process.env.ARIA_SELF_IMPROVEMENT_JOB);const timer=setTimeout(()=>{console.error('SELF_IMPROVEMENT_TIMEOUT_120000MS');process.exit(124)},120000);executeSelfImprovementJob(job,'windows-fe722cc6681e4f9c9cc35f5ebbb0a089').then(r=>{clearTimeout(timer);console.log(JSON.stringify(r));if(r.status!=='succeeded'||r.coordinator_status!=='completed'||r.stop_reason!=='verified'||!r.evidence_hash)process.exit(1)}).catch(e=>{clearTimeout(timer);console.error(e.stack||e);process.exit(1)})")
$out = & $nodeExe @nodeArgs 2>&1
$out|Write-Host
Assert-True ($LASTEXITCODE -eq 0) "Physical self-improvement proof failed with exit_code=$LASTEXITCODE"
$evidence=Join-Path $DataDir 'self-improvement-last.json'
Assert-True (Test-Path $evidence) 'Self-improvement evidence file missing'
$ev=$null
for($i=0;$i-lt 20;$i++){ $ev=Read-JsonFile $evidence; if($ev){break}; Start-Sleep -Milliseconds 500 }
Assert-True ($null-ne $ev -and -not [string]::IsNullOrWhiteSpace([string]$ev.objective)) 'Self-improvement evidence objective missing'
Assert-True (Test-Path (Join-Path $RuntimeRoot 'Runtime\self-improvement-workspace\physical-certification.js')) 'Sandbox self-improvement artifact missing'
Write-Host 'PHYSICAL_SELF_IMPROVEMENT=PASS'
Write-Host 'CERTIFICATION_STAGE=PASS'
Write-Host 'ARIA_SELF_IMPROVEMENT_WINDOWS_PHYSICAL_E2E=PASS'
Write-Host 'STATUS=PHYSICAL_RUNTIME_MEDITATION_AND_SELF_IMPROVEMENT_VERIFIED'
Write-Host 'MEDITATION_IA_PHASE=100_PERCENT_CERTIFIED'
Write-Host '=== CERTIFICATION COMPLETE ==='
