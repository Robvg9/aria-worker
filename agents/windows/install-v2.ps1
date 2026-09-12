$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$DataDir = Join-Path $RuntimeRoot 'Data'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$ConfigPath = Join-Path $DataDir 'config.json'
$TokenPath = Join-Path $DataDir 'device-token.dpapi'
$TaskXmlPath = Join-Path $RuntimeRoot 'ARIA-Windows-Local-Agent.xml'
$TaskName = 'ARIA-Windows-Local-Agent'
$NodePath = (Get-Command node -ErrorAction Stop).Source
$GatewayUrl = 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway'
$DeviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'

foreach ($dir in @($RuntimeRoot, $RuntimeDir, $DataDir, $LogDir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

# Materialize the agent runtime on D:. C: remains only the Git repository.
Copy-Item -Path (Join-Path $AgentRoot 'aria-agent.js') -Destination (Join-Path $RuntimeDir 'aria-agent.js') -Force

$runSource = Join-Path $AgentRoot 'run-agent.ps1'
Copy-Item -Path $runSource -Destination (Join-Path $RuntimeDir 'run-agent.ps1') -Force

$token = $env:ARIA_DEVICE_TOKEN
if (-not [string]::IsNullOrWhiteSpace($token)) {
    if ($token.Length -lt 32) { throw 'ARIA_DEVICE_TOKEN invalido.' }
    $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = $secure | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII
}
elseif (Test-Path $TokenPath) {
    # Existing D: DPAPI store is authoritative.
}
elseif (Test-Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi')) {
    # Migrate the existing DPAPI ciphertext; it remains decryptable by the same user.
    Copy-Item -Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi') -Destination $TokenPath -Force
}
else {
    $token = Read-Host 'Pega el token del Windows Device'
    if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32) {
        throw 'Token ausente o invalido. No se instalo nada.'
    }
    $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = $secure | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII
}

if (-not (Test-Path $TokenPath)) {
    throw "ARIA token store was not created: $TokenPath"
}

$config = [ordered]@{
    device_id = $DeviceId
    gateway_url = $GatewayUrl
    node_path = $NodePath
    agent_version = 'aria-windows-agent-v1'
    runtime_root = $RuntimeRoot
    runtime_dir = $RuntimeDir
    data_dir = $DataDir
    log_dir = $LogDir
    heartbeat_ms = 30000
    poll_ms = 3000
    gateway_timeout_ms = 15000
    gateway_retries = 2
}
$config | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8

$taskUser = "$env:COMPUTERNAME\$env:USERNAME"
$taskRunScript = Join-Path $RuntimeDir 'run-agent.ps1'
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$taskUser</Author>
    <Description>ARIA Windows Local Agent</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$taskUser</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$taskUser</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>powershell.exe</Command>
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File &quot;$taskRunScript&quot;</Arguments>
      <WorkingDirectory>$RuntimeDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Set-Content -Path $TaskXmlPath -Value $xml -Encoding Unicode

# Replace the old task with the D: runtime task.
schtasks.exe /Delete /TN $TaskName /F 2>$null | Out-Null
$result = & schtasks.exe /Create /TN $TaskName /XML $TaskXmlPath /F 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo registrar la tarea ARIA. schtasks exit code: $LASTEXITCODE`n$result"
}

& schtasks.exe /Run /TN $TaskName | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo iniciar la tarea ARIA. ExitCode=$LASTEXITCODE"
}

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host "Task: $TaskName"
Write-Host "Device: $DeviceId"
Write-Host "Runtime: $RuntimeDir"
Write-Host "Config: $ConfigPath"
Write-Host "Token store: $TokenPath"
Write-Host "Public logs: $LogDir\watchdog.log"
Write-Host "Task user: $taskUser"
Write-Host 'Token: protegido con DPAPI del usuario Windows.'
Write-Host 'Inicio automatico: AtLogOn (usuario interactivo)'
Write-Host 'ExecutionTimeLimit: 0'
Write-Host 'RestartOnFailure: 999 / 1 minuto'
