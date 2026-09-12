$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$ConfigDir = Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent'
$ConfigPath = Join-Path $ConfigDir 'config.json'
$TokenPath = Join-Path $ConfigDir 'device-token.dpapi'
$TaskName = 'ARIA-Windows-Local-Agent'
$NodePath = (Get-Command node -ErrorAction Stop).Source
$GatewayUrl = 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway'
$DeviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
$RunScript = Join-Path $AgentRoot 'run-agent.ps1'

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

$token = $env:ARIA_DEVICE_TOKEN
if ([string]::IsNullOrWhiteSpace($token)) {
    $token = Read-Host 'Pega el token del Windows Device'
}
if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32) {
    throw 'Token ausente o invalido. No se instalo nada.'
}

$secure = ConvertTo-SecureString -String $token -AsPlainText -Force
$encrypted = $secure | ConvertFrom-SecureString
Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII

$config = [ordered]@{
    device_id = $DeviceId
    gateway_url = $GatewayUrl
    node_path = $NodePath
    agent_version = 'aria-windows-agent-v1'
    heartbeat_ms = 30000
    poll_ms = 3000
    gateway_timeout_ms = 15000
    gateway_retries = 2
}
$config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8

$taskCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $RunScript + '"'
& schtasks.exe /Create /TN $TaskName /TR $taskCommand /SC ONLOGON /RL LIMITED /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "No se pudo crear la tarea programada. ExitCode=$LASTEXITCODE" }
& schtasks.exe /Run /TN $TaskName | Out-Null
if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar la tarea programada. ExitCode=$LASTEXITCODE" }

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host "Task: $TaskName"
Write-Host "Device: $DeviceId"
Write-Host "Config: $ConfigPath"
Write-Host 'Token: protegido con DPAPI del usuario Windows.'
Write-Host 'Inicio automatico: ONLOGON'
Write-Host 'Watchdog: reinicio automatico del agente si termina.'
