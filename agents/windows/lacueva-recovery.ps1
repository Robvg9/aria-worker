'use strict';

$ErrorActionPreference = 'Continue'
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$DataDir = Join-Path $RuntimeRoot 'Data'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$ConfigPath = Join-Path $DataDir 'config.json'
$TaskName = 'ARIA-Windows-Local-Agent'
$OllamaTask = 'ARIA-Ollama-Local'

Write-Host '=== ARIA LaCueva Recovery ==='
Write-Host ('HOST=' + $env:COMPUTERNAME)

# LaCueva is a worker-light node. Disable local LLM load before bringing the worker back.
try {
  Disable-ScheduledTask -TaskName $OllamaTask -ErrorAction SilentlyContinue | Out-Null
  Get-Process -Name ollama -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Write-Host 'OLLAMA_GUARD=APPLIED'
} catch { Write-Warning ('OLLAMA_GUARD=' + $_.Exception.Message) }

if (Test-Path $ConfigPath) {
  try {
    $config = Get-Content -Raw -Path $ConfigPath | ConvertFrom-Json
    $config.ollama_enabled = $false
    $config.capabilities = @('shell.execute','computer.use','desktop.screenshot','desktop.uia')
    if ($config.hardware_profile) {
      $config.hardware_profile.local_llm_eligible = $false
      $config.hardware_profile.profile = 'worker-light'
    }
    $config | ConvertTo-Json -Depth 20 | Set-Content -Path $ConfigPath -Encoding UTF8
    Write-Host 'CONFIG_OLLAMA_ENABLED=False'
  } catch { Write-Warning ('CONFIG_UPDATE=' + $_.Exception.Message) }
} else {
  Write-Warning ('CONFIG_MISSING=' + $ConfigPath)
}

# Reuse the canonical ARIA task; do not start a legacy DC task in parallel.
try {
  & schtasks.exe /Run /TN $TaskName | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Warning ('TASK_RUN_EXIT=' + $LASTEXITCODE) } else { Write-Host 'ARIA_TASK_RUN=REQUESTED' }
} catch { Write-Warning ('TASK_RUN=' + $_.Exception.Message) }

$heartbeat = Join-Path $LogDir 'agent-heartbeat.json'
$status = Join-Path $LogDir 'status.json'
$supervisor = Join-Path $LogDir 'desktop-commander-supervisor.json'
$deadline = (Get-Date).AddSeconds(120)
$heartbeatFresh = $false
$supervisorReady = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if (Test-Path $heartbeat) {
    $age = ((Get-Date).ToUniversalTime() - (Get-Item $heartbeat).LastWriteTimeUtc).TotalSeconds
    if ($age -lt 120) { $heartbeatFresh = $true }
  }
  if (Test-Path $supervisor) {
    try {
      $j = Get-Content -Raw $supervisor | ConvertFrom-Json
      if ([string]$j.status -eq 'running') { $supervisorReady = $true }
    } catch {}
  }
  if ($heartbeatFresh -and $supervisorReady) { break }
}

Write-Host ('ARIA_HEARTBEAT_FRESH=' + $heartbeatFresh)
Write-Host ('DC_SUPERVISOR_RUNNING=' + $supervisorReady)
if (Test-Path $status) { Get-Content -Raw $status }
if (Test-Path $supervisor) { Get-Content -Raw $supervisor }

if (-not $heartbeatFresh) { throw 'Recovery failed: ARIA heartbeat did not become fresh within 120s.' }
if (-not $supervisorReady) { throw 'Recovery incomplete: Desktop Commander supervisor did not report running within 120s.' }
Write-Host 'LACUEVA_RECOVERY=PASS'
