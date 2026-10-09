$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$SupervisorSource = Join-Path $AgentRoot 'desktop-commander-supervisor.ps1'
$SupervisorTarget = Join-Path $RuntimeDir 'desktop-commander-supervisor.ps1'
$TaskXmlPath = Join-Path $RuntimeRoot 'ARIA-Desktop-Commander-Remote.xml'
$TaskName = 'ARIA-Desktop-Commander-Remote'
$taskUser = (& whoami).Trim()
if ([string]::IsNullOrWhiteSpace($taskUser) -or $taskUser -notmatch '\\') {
    throw "No se pudo resolver una identidad Windows valida para Task Scheduler: '$taskUser'"
}

if (-not (Test-Path $SupervisorSource)) {
    throw "Desktop Commander supervisor not found: $SupervisorSource"
}

$nodeCandidates = @(
    'D:\Databank\node.exe',
    'D:\Databank\node\node.exe'
)
$nodePath = $nodeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $nodePath) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw 'node.exe no encontrado. Instala Node.js antes del bootstrap.' }
    $nodePath = $nodeCommand.Source
}

$toolRoot = Join-Path $RuntimeRoot 'Tools\DesktopCommanderRemote'
$toolCache = Join-Path $toolRoot 'npm-cache'
$dcEntry = Join-Path $toolRoot 'node_modules\@wonderwhy-er\desktop-commander\dist\index.js'

New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
New-Item -ItemType Directory -Force -Path $toolCache | Out-Null

if (-not (Test-Path $dcEntry)) {
    Write-Host '=== INSTALL DESKTOP COMMANDER FIXED RUNTIME ==='
    $previousCache = $env:NPM_CONFIG_CACHE
    $env:NPM_CONFIG_CACHE = $toolCache
    try {
        $npmCandidates = @(
            (Join-Path (Split-Path $nodePath) 'npm.cmd'),
            'D:\Databank\npm.cmd'
        )
        $npmPath = $npmCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
        if (-not $npmPath) {
            $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if ($npmCommand) { $npmPath = $npmCommand.Source }
        }
        if (-not $npmPath) { throw 'npm.cmd no encontrado para instalar Desktop Commander.' }

        & $npmPath install --prefix $toolRoot --no-save "@wonderwhy-er/desktop-commander@0.2.52"
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    }
    finally {
        $env:NPM_CONFIG_CACHE = $previousCache
    }
}

if (-not (Test-Path $dcEntry)) {
    throw "Desktop Commander fixed runtime missing after install: $dcEntry"
}

$versionFile = Join-Path $toolRoot 'node_modules\@wonderwhy-er\desktop-commander\package.json'
$installed = Get-Content -Raw $versionFile | ConvertFrom-Json
if ([string]$installed.version -ne '0.2.52') {
    throw "Desktop Commander version mismatch: expected 0.2.52, found $($installed.version)"
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
      <Delay>PT30S</Delay>
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
