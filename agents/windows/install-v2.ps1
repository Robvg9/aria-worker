$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$DataDir = Join-Path $RuntimeRoot 'Data'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$ConfigPath = Join-Path $DataDir 'config.json'
$TokenPath = Join-Path $DataDir 'device-token.dpapi'
$PowershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$NodePath = (Get-Command node -ErrorAction Stop).Source
$GatewayUrl = 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway'
$DeviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
$RunAgentPath = Join-Path $RuntimeDir 'run-agent.ps1'
$KillRequestPath = Join-Path $LogDir 'kill-request.json'
$WatchdogPidPath = Join-Path $LogDir 'watchdog.pid'
$StartupAuthorityPath = Join-Path $LogDir 'startup-authority.json'
$RuntimeSourceShaPath = Join-Path $LogDir 'runtime-source-sha'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'ARIA-Windows-Local-Agent'

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

foreach ($dirName in @('autonomy','self-development','self-model')) {
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
elseif (-not (Test-Path $TokenPath) -and (Test-Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi'))) {
    Copy-Item -Path (Join-Path $env:LOCALAPPDATA 'ARIA-Windows-Agent\device-token.dpapi') -Destination $TokenPath -Force
}
elseif (-not (Test-Path $TokenPath)) {
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
    startup_authority = 'user_run_singleton'
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8

try {
    New-Item -Path $RunKey -Force | Out-Null
    $runCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $RunAgentPath + '"'
    Set-ItemProperty -Path $RunKey -Name $RunValueName -Value $runCommand
    Write-Host 'ARIA_USER_AUTOSTART=PASS_SOLE_STARTUP_AUTHORITY'
} catch {
    throw ("Unable to configure user startup authority: {0}" -f $_.Exception.Message)
}

$authority = [ordered]@{
    authority = 'user_run_singleton'
    run_key = $RunValueName
    task_scheduler = 'not_used_by_aria'
    watchdog_mutex = 'Global\\ARIA-Windows-Agent-Watchdog-v1'
    updated_at = (Get-Date).ToUniversalTime().ToString('o')
    reason = 'single-owner-startup'
}
$authority | ConvertTo-Json -Depth 10 | Set-Content -Path $StartupAuthorityPath -Encoding UTF8

$watchdogAlive = $false
if (Test-Path $WatchdogPidPath) {
    try {
        $watchdogPid = [int](Get-Content -Raw $WatchdogPidPath).Trim()
        Get-Process -Id $watchdogPid -ErrorAction Stop | Out-Null
        $watchdogAlive = $true
    } catch {}
}
if ($watchdogAlive) {
    $runtimeSha = ''
    try { if (Test-Path $RuntimeSourceShaPath) { $runtimeSha = (Get-Content -Raw $RuntimeSourceShaPath).Trim() } } catch {}
    if ([string]::IsNullOrWhiteSpace($runtimeSha)) { $runtimeSha = 'installer-local-refresh' }
    [ordered]@{ source_sha = $runtimeSha; reason = 'installer_reload'; requested_at = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress | Set-Content -Path $KillRequestPath -Encoding UTF8 -Force
    Write-Host 'ARIA_AGENT_RELOAD_REQUESTED=PASS'
} else {
    Start-Process -FilePath $PowershellPath -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$RunAgentPath) -WorkingDirectory $RuntimeDir -WindowStyle Hidden | Out-Null
    Write-Host 'ARIA_WATCHDOG_STARTED_FROM_INSTALLER=PASS_SINGLETON'
}

$runtimeSmoke = & $NodePath -e "const x=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js'); if(typeof x.executeSelfImprovementJob!=='function') process.exit(1); console.log('SELF_IMPROVEMENT_RUNTIME_LOAD=PASS')" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Self-improvement runtime load failed: $runtimeSmoke" }
$runtimeSmoke | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host 'StartupAuthority: user_run_singleton'
Write-Host "StartupAuthorityFile: $StartupAuthorityPath"
Write-Host "Device: $DeviceId"
Write-Host "Runtime: $RuntimeDir"