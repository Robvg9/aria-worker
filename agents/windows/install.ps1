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

New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

if (-not $env:ARIA_DEVICE_TOKEN) {
    $token = Read-Host 'Pega el token del Windows Device'
} else {
    $token = $env:ARIA_DEVICE_TOKEN
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

$runScript = Join-Path $AgentRoot 'run-agent.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runScript`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType InteractiveToken -RunLevel LeastPrivilege

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host "Task: $TaskName"
Write-Host "Device: $DeviceId"
Write-Host "Config: $ConfigPath"
Write-Host 'Token: protegido con DPAPI del usuario Windows.'
Write-Host 'El agente arrancara automaticamente al iniciar sesion y se reiniciara si termina.'
