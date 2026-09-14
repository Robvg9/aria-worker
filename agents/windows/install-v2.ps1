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
$DesktopSmokePath = Join-Path $LogDir 'desktop-smoke.json'
$TaskName = 'ARIA-Windows-Local-Agent'
$NodePath = (Get-Command node -ErrorAction Stop).Source
$GatewayUrl = 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway'
$DeviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'

foreach ($dir in @($RuntimeRoot, $RuntimeDir, $DataDir, $LogDir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

$requiredSources = @{
    'aria-agent.js' = Join-Path $AgentRoot 'aria-agent.js'
    'aria-meditation-controller.js' = Join-Path $AgentRoot 'aria-meditation-controller.js'
    'self-improvement-runtime.js' = Join-Path $AgentRoot 'self-improvement-runtime.js'
    'run-agent.ps1' = Join-Path $AgentRoot 'run-agent.ps1'
    'windows-shell-executor.js' = Join-Path $RepoRoot 'autonomy\windows-shell-executor.js'
    'windows-desktop-adapter.js' = Join-Path $RepoRoot 'computer-use\windows-desktop-adapter.js'
    'windows-desktop-runner.ps1' = Join-Path $RepoRoot 'computer-use\windows-desktop-runner.ps1'
    'windows-ui-automation.ps1' = Join-Path $RepoRoot 'computer-use\windows-ui-automation.ps1'
}
foreach ($file in $requiredSources.Keys) {
    $source = $requiredSources[$file]
    if (-not (Test-Path $source)) { throw "Required Windows agent file missing: $source" }
    Copy-Item -Path $source -Destination (Join-Path $RuntimeDir $file) -Force
}

$coordinatorDirs = @('autonomy', 'self-development', 'self-model')
foreach ($dirName in $coordinatorDirs) {
    $sourceDir = Join-Path $RepoRoot $dirName
    $destDir = Join-Path $RuntimeRoot "Runtime\$dirName"
    if (-not (Test-Path $sourceDir)) { throw "Required self-improvement runtime directory missing: $sourceDir" }
    New-Item -ItemType Directory -Force -Path $destDir | Out-Null
    Copy-Item -Path (Join-Path $sourceDir '*') -Destination $destDir -Recurse -Force
}

$token = $env:ARIA_DEVICE_TOKEN
if (-not [string]::IsNullOrWhiteSpace($token)) {
    if ($token.Length -lt 32) { throw 'ARIA_DEVICE_TOKEN invalido.' }
    $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = $secure | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII
}
elseif (Test-Path $TokenPath) {
}
elseif (Test-Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi')) {
    Copy-Item -Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi') -Destination $TokenPath -Force
}
else {
    $token = Read-Host 'Pega el token del Windows Device'
    if ([string]::IsNullOrWhiteSpace($token) -or $token.Length -lt 32) { throw 'Token ausente o invalido. No se instalo nada.' }
    $secure = ConvertTo-SecureString -String $token -AsPlainText -Force
    $encrypted = $secure | ConvertFrom-SecureString
    Set-Content -Path $TokenPath -Value $encrypted -Encoding ASCII
}
if (-not (Test-Path $TokenPath)) { throw "ARIA token store was not created: $TokenPath" }

$config = [ordered]@{
    device_id = $DeviceId
    gateway_url = $GatewayUrl
    node_path = $NodePath
    agent_version = 'aria-windows-agent-v2'
    runtime_root = $RuntimeRoot
    capabilities = @('ollama.qwen3','shell.execute','computer.use','self.improve')
    desktop_version = 'aria-windows-desktop-v1.8'
    meditation_version = 'aria-meditation-ia-v1'
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8

$taskUser = "$env:USERDOMAIN\$env:USERNAME"
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>ARIA Windows Local Agent v2 + Meditation IA</Description></RegistrationInfo>
  <Triggers><LogonTrigger><Enabled>true</Enabled></LogonTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>$taskUser</UserId><LogonType>InteractiveToken</LogonType><RunLevel>Limited</RunLevel></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <!-- RestartOnFailure.Count is an unsignedByte in Task Scheduler, so the maximum valid value is 255. -->
    <RestartOnFailure><Interval>PT1M</Interval><Count>255</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File &quot;$RuntimeDir\run-agent.ps1&quot;</Arguments><WorkingDirectory>$RuntimeDir</WorkingDirectory></Exec></Actions>
</Task>
"@
Set-Content -Path $TaskXmlPath -Value $xml -Encoding Unicode

$existingTask = $null
try { $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch {}
if ($existingTask) {
    Write-Host 'ARIA_TASK_ALREADY_EXISTS=REUSING_EXISTING_TASK'
    try {
        & schtasks.exe /Run /TN $TaskName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "schtasks /Run exit code: $LASTEXITCODE" }
    } catch {
        Write-Host "ARIA_TASK_RUN_NONBLOCKING=$($_.Exception.Message)"
    }
} else {
    $result = & schtasks.exe /Create /TN $TaskName /XML $TaskXmlPath /F 2>&1
    if ($LASTEXITCODE -ne 0) { throw "No se pudo registrar la tarea ARIA. schtasks exit code: $LASTEXITCODE`n$result" }
    & schtasks.exe /Run /TN $TaskName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No se pudo iniciar la tarea ARIA. ExitCode=$LASTEXITCODE" }
}

$runtimeSmoke = & $NodePath -e "const x=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js'); if(typeof x.executeSelfImprovementJob!=='function') process.exit(1); console.log('SELF_IMPROVEMENT_RUNTIME_LOAD=PASS')" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Self-improvement runtime load failed: $runtimeSmoke" }
$runtimeSmoke | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host "Task: $TaskName"
Write-Host "Device: $DeviceId"
Write-Host "Runtime: $RuntimeDir"