$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$SupervisorSource = Join-Path $AgentRoot 'desktop-commander-supervisor.ps1'
$SupervisorTarget = Join-Path $RuntimeDir 'desktop-commander-supervisor.ps1'
$TaskXmlPath = Join-Path $RuntimeRoot 'ARIA-Desktop-Commander-Remote.xml'
$TaskName = 'ARIA-Desktop-Commander-Remote'
$taskUser = "$env:COMPUTERNAME\$env:USERNAME"

if (-not (Test-Path $SupervisorSource)) {
    throw "Desktop Commander supervisor not found: $SupervisorSource"
}

$npx = Get-Command npx.cmd -ErrorAction SilentlyContinue
if (-not $npx) {
    throw 'npx.cmd not found. Install Node.js/npm first.'
}

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Copy-Item -Path $SupervisorSource -Destination $SupervisorTarget -Force

function Escape-Xml([string]$Value) {
    return [System.Security.SecurityElement]::Escape($Value)
}

$escapedUser = Escape-Xml $taskUser
$escapedScript = Escape-Xml $SupervisorTarget

$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Author>$escapedUser</Author>
    <Description>ARIA supervisor for Desktop Commander Remote</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>$escapedUser</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$escapedUser</UserId>
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
      <Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File &quot;$escapedScript&quot;</Arguments>
      <WorkingDirectory>$RuntimeDir</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

Set-Content -Path $TaskXmlPath -Value $xml -Encoding Unicode -Force

& cmd.exe /c "schtasks.exe /Delete /TN ""$TaskName"" /F >nul 2>&1"
$result = & schtasks.exe /Create /TN $TaskName /XML $TaskXmlPath /F 2>&1
if ($LASTEXITCODE -ne 0) {
    throw ("No se pudo registrar la tarea {0}. ExitCode={1} {2}" -f $TaskName, $LASTEXITCODE, ($result -join [Environment]::NewLine))
}

& schtasks.exe /Run /TN $TaskName | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo arrancar la tarea $TaskName. ExitCode=$LASTEXITCODE"
}

Start-Sleep -Seconds 3
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
$info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop

Write-Host '=== ARIA DESKTOP COMMANDER AUTOSTART ==='
Write-Host "Task: $TaskName"
Write-Host "Task state: $($task.State)"
Write-Host "Last run: $($info.LastRunTime)"
Write-Host "Last result: $($info.LastTaskResult)"
Write-Host "Supervisor: $SupervisorTarget"
Write-Host 'Startup: AtLogOn / InteractiveToken'
Write-Host 'Pinned Desktop Commander version: 0.2.52'
Write-Host 'Recovery: supervisor loop + task RestartOnFailure'
Write-Host 'Human Gate preserved for pairing/authentication.'
