$ErrorActionPreference = 'Stop'

$AgentRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $AgentRoot)
$RuntimeRoot = 'D:\ARIA-Windows-Agent'
$RuntimeDir = Join-Path $RuntimeRoot 'Runtime\windows'
$DataDir = Join-Path $RuntimeRoot 'Data'
$LogDir = Join-Path $RuntimeRoot 'Logs'
$ConfigPath = Join-Path $DataDir 'config.json'
$TokenPath = Join-Path $DataDir 'device-token.dpapi'
$TaskName = 'ARIA-Windows-Local-Agent'
$PowershellPath = (Get-Command powershell.exe -ErrorAction Stop).Source
$NodePath = (Get-Command node -ErrorAction Stop).Source
$GatewayUrl = 'https://icuqsstxfdbvjytkhlog.supabase.co/functions/v1/aria-device-gateway'
$DeviceId = 'windows-fe722cc6681e4f9c9cc35f5ebbb0a089'
$RunAgentPath = Join-Path $RuntimeDir 'run-agent.ps1'
$KillRequestPath = Join-Path $LogDir 'kill-request'
$WatchdogPidPath = Join-Path $LogDir 'watchdog.pid'
$StartupAuthorityPath = Join-Path $LogDir 'startup-authority.json'
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
    installed_at = (Get-Date).ToUniversalTime().ToString('o')
}
$config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigPath -Encoding UTF8

# IMPORTANT: the installer is deliberately NOT allowed to kill the running agent.
# The watchdog is the sole lifecycle owner. Reconfiguration is requested through a
# file signal, which avoids cross-owner Stop-Process / Access-Denied races.

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskRegistered = $false
$taskError = $null
$action = New-ScheduledTaskAction -Execute $PowershellPath -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $RunAgentPath + '"') -WorkingDirectory $RuntimeDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 255 -RestartInterval (New-TimeSpan -Minutes 1)

try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    $taskRegistered = $true
    Write-Host "ARIA_TASK_REGISTRATION=PASS identity=$identity"
} catch {
    $taskError = $_.Exception.Message
    Write-Warning ("Scheduled Task registration unavailable: {0}" -f $taskError)
}

if ($taskRegistered) {
    # Scheduled Task is the SOLE startup authority. Remove the user-run fallback so
    # a logon cannot start a second watchdog/agent pair.
    try {
        Remove-ItemProperty -Path $RunKey -Name $RunValueName -ErrorAction SilentlyContinue
        Write-Host 'ARIA_USER_AUTOSTART_FALLBACK=DISABLED_TASK_AUTHORITY'
    } catch {
        throw ("Unable to remove conflicting user autostart fallback: {0}" -f $_.Exception.Message)
    }

    $authority = [ordered]@{
        authority = 'scheduled_task'
        task_name = $TaskName
        run_key_enabled = $false
        updated_at = (Get-Date).ToUniversalTime().ToString('o')
        reason = 'single-owner-startup'
    }
} else {
    # Fallback authority is used only when task registration is genuinely unavailable.
    # A stale/partial task is disabled so the fallback remains the only startup source.
    try {
        $existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($null -ne $existingTask) {
            try { Disable-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Out-Null } catch {}
        }
    } catch {}

    try {
        New-Item -Path $RunKey -Force | Out-Null
        $runCommand = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $RunAgentPath + '"'
        Set-ItemProperty -Path $RunKey -Name $RunValueName -Value $runCommand
        Write-Host 'ARIA_USER_AUTOSTART_FALLBACK=PASS_SOLE_AUTHORITY'
    } catch {
        throw ("Unable to configure user autostart fallback: {0}" -f $_.Exception.Message)
    }

    $authority = [ordered]@{
        authority = 'user_run_fallback'
        task_name = $TaskName
        run_key_enabled = $true
        updated_at = (Get-Date).ToUniversalTime().ToString('o')
        reason = 'scheduled-task-unavailable'
        task_error = $taskError
    }
}

$authority | ConvertTo-Json -Depth 10 | Set-Content -Path $StartupAuthorityPath -Encoding UTF8

# Never spawn a second watchdog from the installer when one is already alive.
$watchdogAlive = $false
if (Test-Path $WatchdogPidPath) {
    try {
        $watchdogPid = [int](Get-Content -Raw $WatchdogPidPath).Trim()
        Get-Process -Id $watchdogPid -ErrorAction Stop | Out-Null
        $watchdogAlive = $true
    } catch {}
}
if ($watchdogAlive) {
    Set-Content -Path $KillRequestPath -Value 'installer_reload' -Encoding UTF8 -Force
    Write-Host 'ARIA_AGENT_RELOAD_REQUESTED=PASS'
} elseif (-not $taskRegistered) {
    Start-Process -FilePath $PowershellPath -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$RunAgentPath) -WorkingDirectory $RuntimeDir -WindowStyle Hidden | Out-Null
    Write-Host 'ARIA_AGENT_STARTED_FROM_INSTALLER=PASS_FALLBACK_AUTHORITY'
} else {
    Write-Host 'ARIA_AGENT_START_DEFERRED_TO_SCHEDULED_TASK=PASS'
}

$runtimeSmoke = & $NodePath -e "const x=require('D:\\ARIA-Windows-Agent\\Runtime\\windows\\self-improvement-runtime.js'); if(typeof x.executeSelfImprovementJob!=='function') process.exit(1); console.log('SELF_IMPROVEMENT_RUNTIME_LOAD=PASS')" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Self-improvement runtime load failed: $runtimeSmoke" }
$runtimeSmoke | ForEach-Object { Write-Host $_ }

Write-Host ''
Write-Host 'ARIA Windows Agent instalado correctamente.'
Write-Host "Task: $TaskName registered=$taskRegistered"
Write-Host "StartupAuthority: $StartupAuthorityPath"
Write-Host "Device: $DeviceId"
Write-Host "Runtime: $RuntimeDir"