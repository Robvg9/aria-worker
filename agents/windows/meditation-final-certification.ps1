$ErrorActionPreference = 'Stop'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Write-Host '=== ARIA MEDITATION IA FINAL PHYSICAL CERTIFICATION ==='
Write-Host "SOURCE_COMMIT=$env:ARIA_EXPECTED_SHA"

# Stage 1 - persistence and auto-start
Write-Host '--- STAGE 1: PERSISTENCE / AUTO-START ---'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File '.\agents\windows\install-v2.ps1'
if ($LASTEXITCODE -ne 0) { throw "Installer exit=$LASTEXITCODE" }
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$run = (Get-ItemProperty $runKey -Name 'ARIA-Windows-Local-Agent' -ErrorAction SilentlyContinue).'ARIA-Windows-Local-Agent'
Assert-True (-not [string]::IsNullOrWhiteSpace($run) -and $run -match 'run-agent\.ps1') 'ARIA user auto-start missing'
$statusPath = 'D:\ARIA-Windows-Agent\Logs\status.json'
$ready = $false
for ($i = 0; $i -lt 45; $i++) {
  if (Test-Path $statusPath) {
    try {
      $s = Get-Content -Raw $statusPath | ConvertFrom-Json
      if ($s.state -eq 'agent_running') { $ready = $true; break }
    } catch {}
  }
  Start-Sleep -Seconds 1
}
Assert-True $ready 'ARIA watchdog/agent not running'
$m = $null
for ($i = 0; $i -lt 30; $i++) {
  try {
    $m = Invoke-RestMethod 'http://127.0.0.1:45873/status' -TimeoutSec 3
    if ($m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'active') { break }
    if ($m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'standby') {
      try { Invoke-RestMethod -Method Post 'http://127.0.0.1:45873/start' -TimeoutSec 3 | Out-Null } catch {}
    }
  } catch {}
  Start-Sleep -Seconds 1
}
Assert-True ($m -and $m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'active') "Meditation not active: $($m.mode)"
Write-Host 'PERSISTENCE_STAGE=PASS'

# Stage 2 - recovery and singleton
Write-Host '--- STAGE 2: RECOVERY / SINGLE-INSTANCE ---'
$before = Get-Content -Raw $statusPath | ConvertFrom-Json
$beforePid = [string]$before.agent_pid
Assert-True (-not [string]::IsNullOrWhiteSpace($beforePid)) 'Missing current agent pid'
Set-Content -Path 'D:\ARIA-Windows-Agent\Logs\kill-request' -Value 'final-cert-recovery' -Encoding UTF8 -Force
$new = $null
for ($i = 0; $i -lt 75; $i++) {
  try { $new = Get-Content -Raw $statusPath | ConvertFrom-Json } catch {}
  if ($new -and $new.state -eq 'agent_running' -and [string]$new.agent_pid -ne $beforePid) { break }
  Start-Sleep -Seconds 1
}
Assert-True ($new -and $new.state -eq 'agent_running') 'Watchdog did not recover agent'
Assert-True ([string]$new.agent_pid -ne $beforePid) 'Agent PID did not change during recovery'
$m = $null
for ($i = 0; $i -lt 75; $i++) {
  try {
    $m = Invoke-RestMethod 'http://127.0.0.1:45873/status' -TimeoutSec 3
    if ($m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'active') { break }
  } catch {}
  Start-Sleep -Seconds 1
}
Assert-True ($m -and $m.version -eq 'aria-meditation-ia-v1' -and $m.mode -eq 'active') 'Meditation did not recover to active'
$agents = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match 'aria-agent\.js' })
Assert-True ($agents.Count -eq 1) "Expected one ARIA agent process, found $($agents.Count)"
Write-Host "ARIA_AGENT_RECOVERY=$beforePid->$($new.agent_pid)"
Write-Host 'SINGLE_AGENT_INSTANCE=PASS'
Write-Host 'WATCHDOG_MEDITATION_RECOVERY=PASS'
Write-Host 'RECOVERY_STAGE=PASS'

# Stage 3 - live Meditation / gateway
Write-Host '--- STAGE 3: LIVE MEDITATION / ARIA GATEWAY ---'
$startTick = [int]$m.tick_count
$advanced = $false
for ($i = 0; $i -lt 50; $i++) {
  Start-Sleep -Seconds 1
  $m2 = Invoke-RestMethod 'http://127.0.0.1:45873/status' -TimeoutSec 5
  if ([int]$m2.tick_count -gt $startTick) { $advanced = $true; break }
}
Assert-True $advanced "Meditation tick did not advance from $startTick"
Assert-True ($m2.mode -eq 'active') 'Meditation lost active mode'
Assert-True ($null -ne $m2.last_result) 'Meditation produced no result'
Assert-True ($m2.last_result.error -ne 'meditation_gateway_config_missing') 'Meditation gateway configuration missing'
$medLog = 'D:\ARIA-Windows-Agent\Runtime\meditation\ARIA-Meditation-IA.txt'
Assert-True (Test-Path $medLog) 'Meditation log missing'
$tail = Get-Content $medLog -Tail 100 -ErrorAction Stop
Assert-True ((($tail -join "`n") -match 'JOB RESULT|IDLE tick=') ) 'No recent autonomous Meditation activity in log'
Write-Host "MEDITATION_TICK_ADVANCE=$startTick->$($m2.tick_count)"
Write-Host ('MEDITATION_GATEWAY_RESULT=' + ($m2.last_result | ConvertTo-Json -Compress -Depth 12))
Write-Host 'INTEGRATION_STAGE=PASS'

# Stage 4 - real local physical self-improvement proof
Write-Host '--- STAGE 4: PHYSICAL SELF-IMPROVEMENT ---'
$runtime = 'D:\ARIA-Windows-Agent\Runtime\windows\self-improvement-runtime.js'
Assert-True (Test-Path $runtime) 'Self-improvement runtime missing'
$job = @{
  device_id = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
  operation = 'self.improve'
  command = (@{
    goal = 'Meditation IA final physical reliability certification'
    category = 'reliability'
    risk = 'LOW'
    scope = @('physical-certification.js')
    proposed_changes = @(@{ path = 'physical-certification.js'; content = "module.exports = { status: 'ok' };"; risk_level = 'LOW' })
    mission_id = 'aria-meditation-final-certification'
    step_id = 'physical-self-improvement'
  } | ConvertTo-Json -Compress -Depth 10)
} | ConvertTo-Json -Compress -Depth 10
$env:ARIA_SELF_IMPROVEMENT_JOB = $job
$out = & node -e "const {executeSelfImprovementJob}=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js'); const job=JSON.parse(process.env.ARIA_SELF_IMPROVEMENT_JOB); executeSelfImprovementJob(job, 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089').then(r=>{console.log(JSON.stringify(r)); if(r.status!=='succeeded'||r.coordinator_status!=='completed'||r.stop_reason!=='verified') process.exit(1)}).catch(e=>{console.error(e.stack||e);process.exit(1)})" 2>&1
$out | Write-Host
Assert-True ($LASTEXITCODE -eq 0) 'Physical self-improvement proof failed'
$evidence = 'D:\ARIA-Windows-Agent\Data\self-improvement-last.json'
Assert-True (Test-Path $evidence) 'Self-improvement evidence file missing'
$ev = Get-Content -Raw $evidence | ConvertFrom-Json
Assert-True (-not [string]::IsNullOrWhiteSpace([string]$ev.objective)) 'Self-improvement evidence objective missing'
Write-Host 'PHYSICAL_SELF_IMPROVEMENT=PASS'
Write-Host 'CERTIFICATION_STAGE=PASS'
Write-Host 'ARIA_SELF_IMPROVEMENT_WINDOWS_PHYSICAL_E2E=PASS'
Write-Host 'STATUS=PHYSICAL_RUNTIME_MEDITATION_AND_SELF_IMPROVEMENT_VERIFIED'
Write-Host 'MEDITATION_IA_PHASE=100_PERCENT_CERTIFIED'
Write-Host '=== CERTIFICATION COMPLETE ==='