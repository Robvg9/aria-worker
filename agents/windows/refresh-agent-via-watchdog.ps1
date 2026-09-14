$ErrorActionPreference = 'Continue'

$logDir = 'D:\ARIA-Windows-Agent\Logs'
$runtimeDir = 'D:\ARIA-Windows-Agent\Runtime\windows'
$dataDir = 'D:\ARIA-Windows-Agent\Data'
$statusPath = Join-Path $logDir 'status.json'
$watchdogPidPath = Join-Path $logDir 'watchdog.pid'
$agentPidPath = Join-Path $logDir 'agent.pid'
$requestPath = Join-Path $logDir 'kill-request.json'
$watchdogLogPath = Join-Path $logDir 'watchdog.log'
$runtimeShaPath = Join-Path $logDir 'runtime-source-sha'
$watchdogScript = Join-Path $runtimeDir 'run-agent.ps1'
$configPath = Join-Path $dataDir 'config.json'
$tokenPath = Join-Path $dataDir 'device-token.dpapi'
$sourceSha = [string]$env:ARIA_EXPECTED_SHA
$probeResultPath = Join-Path $logDir 'cpau-probe-result.json'

# --- P/Invoke: WTS + CreateProcessAsUser + privilege enable ---
$cpauType = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public class CPAU {
    public const int WTSActive = 0;
    public const uint TOKEN_ALL_ACCESS = 0x000F01FF;
    public const uint TOKEN_ADJUST_PRIVILEGES = 0x0020;
    public const uint TOKEN_QUERY = 0x0008;
    public const uint SE_PRIVILEGE_ENABLED = 0x00000002;
    public const uint SecurityImpersonation = 2;
    public const uint TokenPrimary = 1;
    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint CREATE_NO_WINDOW = 0x08000000;
    public const uint NORMAL_PRIORITY_CLASS = 0x00000020;
    public const int WTSUserName = 5;

    [StructLayout(LayoutKind.Sequential)]
    public struct WTS_SESSION_INFO {
        public int SessionId;
        public IntPtr pWinStationName;
        public int State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential, Pack = 1)]
    public struct LUID {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct LUID_AND_ATTRIBUTES {
        public LUID Luid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct TOKEN_PRIVILEGES {
        public uint PrivilegeCount;
        public LUID_AND_ATTRIBUTES Privileges;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSEnumerateSessions(IntPtr hServer, int Reserved, int Version, out IntPtr ppSessionInfo, out int pCount);

    [DllImport("wtsapi32.dll")]
    public static extern void WTSFreeMemory(IntPtr pMemory);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSQueryUserToken(int SessionId, out IntPtr phToken);

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool WTSQuerySessionInformation(IntPtr hServer, int SessionId, int WTSInfoClass, out IntPtr ppBuffer, out int pBytesReturned);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DuplicateTokenEx(IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes, uint ImpersonationLevel, uint TokenType, out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessAsUser(IntPtr hToken, string lpApplicationName, string lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(IntPtr ProcessHandle, uint DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, uint BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr GetCurrentProcess();

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll")]
    public static extern uint GetLastError();

    public static bool EnableSeTcbPrivilege() {
        IntPtr hToken = IntPtr.Zero;
        try {
            if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out hToken))
                return false;
            LUID luid;
            if (!LookupPrivilegeValue(null, "SeTcbPrivilege", out luid))
                return false;
            TOKEN_PRIVILEGES tp = new TOKEN_PRIVILEGES();
            tp.PrivilegeCount = 1;
            tp.Privileges.Luid = luid;
            tp.Privileges.Attributes = SE_PRIVILEGE_ENABLED;
            if (!AdjustTokenPrivileges(hToken, false, ref tp, 0, IntPtr.Zero, IntPtr.Zero))
                return false;
            // AdjustTokenPrivileges can return true even when privilege was not held;
            // GetLastError == 1300 (ERROR_NOT_ALL_ASSIGNED) means it failed partially.
            uint err = GetLastError();
            return err == 0;
        } finally {
            if (hToken != IntPtr.Zero) CloseHandle(hToken);
        }
    }
}
'@

if (-not ([System.Management.Automation.PSTypeName]'CPAU').Type) {
    Add-Type -TypeDefinition $cpauType -ErrorAction Stop
}

function Enable-TcbPrivilege {
    $ok = [CPAU]::EnableSeTcbPrivilege()
    $err = [CPAU]::GetLastError()
    Write-Host ("SeTcbPrivilege_ENABLE ok=" + $ok + " lastError=" + $err)
    return $ok
}

function Get-ActiveInteractiveSessionId {
    $ppSessionInfo = [IntPtr]::Zero
    $count = 0
    $ok = [CPAU]::WTSEnumerateSessions([IntPtr]::Zero, 0, 1, [ref]$ppSessionInfo, [ref]$count)
    if (-not $ok) {
        $err = [CPAU]::GetLastError()
        Write-Host ("WTSEnumerateSessions_FAIL err=" + $err)
        return -1
    }
    try {
        $structSize = [System.Runtime.InteropServices.Marshal]::SizeOf([type][CPAU+WTS_SESSION_INFO])
        for ($i = 0; $i -lt $count; $i++) {
            $ptr = [IntPtr]::Add($ppSessionInfo, $i * $structSize)
            $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CPAU+WTS_SESSION_INFO])
            if ($info.State -eq [CPAU]::WTSActive -and $info.SessionId -gt 0) {
                $buf = [IntPtr]::Zero
                $bytes = 0
                $nameOk = [CPAU]::WTSQuerySessionInformation([IntPtr]::Zero, $info.SessionId, [CPAU]::WTSUserName, [ref]$buf, [ref]$bytes)
                $userName = ''
                if ($nameOk -and $buf -ne [IntPtr]::Zero) {
                    $userName = [System.Runtime.InteropServices.Marshal]::PtrToStringUni($buf)
                    [CPAU]::WTSFreeMemory($buf)
                }
                Write-Host ("WTS_SESSION id=" + $info.SessionId + " state=Active user=" + $userName)
                if ($userName -and ($userName -ieq 'robvg' -or $userName -match 'robvg')) {
                    return $info.SessionId
                }
                if ($userName) { return $info.SessionId }
            }
        }
        for ($i = 0; $i -lt $count; $i++) {
            $ptr = [IntPtr]::Add($ppSessionInfo, $i * $structSize)
            $info = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][CPAU+WTS_SESSION_INFO])
            if ($info.State -eq [CPAU]::WTSActive -and $info.SessionId -gt 0) {
                Write-Host ("WTS_SESSION_FALLBACK id=" + $info.SessionId)
                return $info.SessionId
            }
        }
    } finally {
        if ($ppSessionInfo -ne [IntPtr]::Zero) { [CPAU]::WTSFreeMemory($ppSessionInfo) }
    }
    Write-Host 'WTS_NO_ACTIVE_SESSION'
    return -1
}

function Invoke-CreateProcessAsUser {
    param(
        [string]$CommandLine,
        [string]$WorkingDirectory,
        [string]$Label
    )
    # Required: enable SeTcbPrivilege before WTSQueryUserToken
    $privOk = Enable-TcbPrivilege
    if (-not $privOk) {
        Write-Host 'SeTcbPrivilege_NOT_ENABLED continuing_anyway'
    }

    $sessionId = Get-ActiveInteractiveSessionId
    if ($sessionId -le 0) {
        Write-Host ("CPAU_" + $Label + "_NO_SESSION")
        return @{ Ok = $false; Pid = 0; Error = 'no_active_session' }
    }
    Write-Host ("CPAU_" + $Label + "_SESSION=" + $sessionId)

    $userToken = [IntPtr]::Zero
    $primaryToken = [IntPtr]::Zero
    $envBlock = [IntPtr]::Zero
    $hProcess = [IntPtr]::Zero
    $hThread = [IntPtr]::Zero

    try {
        $ok = [CPAU]::WTSQueryUserToken($sessionId, [ref]$userToken)
        if (-not $ok) {
            $err = [CPAU]::GetLastError()
            Write-Host ("WTSQueryUserToken_FAIL session=" + $sessionId + " err=" + $err)
            return @{ Ok = $false; Pid = 0; Error = ("WTSQueryUserToken_" + $err) }
        }
        Write-Host ("WTSQueryUserToken_PASS session=" + $sessionId)

        $ok = [CPAU]::DuplicateTokenEx($userToken, [CPAU]::TOKEN_ALL_ACCESS, [IntPtr]::Zero, [CPAU]::SecurityImpersonation, [CPAU]::TokenPrimary, [ref]$primaryToken)
        if (-not $ok) {
            $err = [CPAU]::GetLastError()
            Write-Host ("DuplicateTokenEx_FAIL err=" + $err)
            return @{ Ok = $false; Pid = 0; Error = ("DuplicateTokenEx_" + $err) }
        }
        Write-Host 'DuplicateTokenEx_PASS'

        $ok = [CPAU]::CreateEnvironmentBlock([ref]$envBlock, $primaryToken, $false)
        if (-not $ok) {
            $err = [CPAU]::GetLastError()
            Write-Host ("CreateEnvironmentBlock_FAIL err=" + $err + " continuing without env block")
            $envBlock = [IntPtr]::Zero
        } else {
            Write-Host 'CreateEnvironmentBlock_PASS'
        }

        $si = New-Object CPAU+STARTUPINFO
        $si.cb = [System.Runtime.InteropServices.Marshal]::SizeOf($si)
        $si.lpDesktop = 'winsta0\default'
        $pi = New-Object CPAU+PROCESS_INFORMATION

        $flags = [CPAU]::CREATE_UNICODE_ENVIRONMENT -bor [CPAU]::CREATE_NO_WINDOW -bor [CPAU]::NORMAL_PRIORITY_CLASS
        $ok = [CPAU]::CreateProcessAsUser(
            $primaryToken,
            $null,
            $CommandLine,
            [IntPtr]::Zero,
            [IntPtr]::Zero,
            $false,
            $flags,
            $envBlock,
            $WorkingDirectory,
            [ref]$si,
            [ref]$pi
        )
        if (-not $ok) {
            $err = [CPAU]::GetLastError()
            Write-Host ("CreateProcessAsUser_FAIL err=" + $err + " cmd=" + $CommandLine)
            return @{ Ok = $false; Pid = 0; Error = ("CreateProcessAsUser_" + $err) }
        }

        $childPid = $pi.dwProcessId
        Write-Host ("CreateProcessAsUser_PASS pid=" + $childPid + " label=" + $Label)
        $hProcess = $pi.hProcess
        $hThread = $pi.hThread
        return @{ Ok = $true; Pid = $childPid; Error = '' }
    } finally {
        if ($userToken -ne [IntPtr]::Zero) { [CPAU]::CloseHandle($userToken) | Out-Null }
        if ($primaryToken -ne [IntPtr]::Zero) { [CPAU]::CloseHandle($primaryToken) | Out-Null }
        if ($envBlock -ne [IntPtr]::Zero) { [CPAU]::DestroyEnvironmentBlock($envBlock) | Out-Null }
        if ($hThread -ne [IntPtr]::Zero) { [CPAU]::CloseHandle($hThread) | Out-Null }
        if ($hProcess -ne [IntPtr]::Zero) { [CPAU]::CloseHandle($hProcess) | Out-Null }
    }
}

function Test-InteractiveUserProbe {
    if (Test-Path $probeResultPath) { Remove-Item $probeResultPath -Force -ErrorAction SilentlyContinue }

    $ps = (Get-Command powershell.exe).Source
    $probeScript = Join-Path $logDir 'cpau-probe.ps1'
    $probeBody = @(
        '$ErrorActionPreference = ''Continue'''
        '$out = @{ username = $env:USERNAME; userdomain = $env:USERDOMAIN; session = [System.Diagnostics.Process]::GetCurrentProcess().SessionId; pid = $PID }'
        'try {'
        '  $tp = ''D:\ARIA-Windows-Agent\Data\device-token.dpapi'''
        '  if (Test-Path $tp) {'
        '    $enc = (Get-Content -Raw $tp).Trim()'
        '    $sec = $enc | ConvertTo-SecureString -ErrorAction Stop'
        '    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)'
        '    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)'
        '    $out.dpapi = ''PASS'''
        '  } else { $out.dpapi = ''MISSING'' }'
        '} catch { $out.dpapi = (''FAIL:'' + $_.Exception.Message) }'
        'try {'
        '  $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()'
        '  $out.sid = $id.User.Value'
        '  $out.name = $id.Name'
        '} catch { $out.sid = ''ERR'' }'
        '$json = ($out | ConvertTo-Json -Compress)'
        '[System.IO.File]::WriteAllText(''D:\ARIA-Windows-Agent\Logs\cpau-probe-result.json'', $json)'
    ) -join "`r`n"
    Set-Content -Path $probeScript -Value $probeBody -Encoding ASCII -Force

    $cmd = ('"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}"' -f $ps, $probeScript)
    $r = Invoke-CreateProcessAsUser -CommandLine $cmd -WorkingDirectory $logDir -Label 'PROBE'
    if (-not $r.Ok) {
        Write-Host ("PROBE_LAUNCH_FAIL error=" + $r.Error)
        return $false
    }
    Write-Host ("PROBE_LAUNCHED pid=" + $r.Pid)

    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Seconds 1
        if (Test-Path $probeResultPath) {
            try {
                $raw = Get-Content -Raw $probeResultPath
                Write-Host ("PROBE_RESULT=" + $raw)
                $j = $raw | ConvertFrom-Json
                if ($j.dpapi -eq 'PASS' -and $j.username -and ($j.username -ieq 'robvg' -or $j.name -match 'robvg')) {
                    Write-Host 'PROBE_DPAPI_AND_IDENTITY=PASS'
                    return $true
                }
                Write-Host ("PROBE_IDENTITY_OR_DPAPI_FAIL user=" + $j.username + " dpapi=" + $j.dpapi)
                return $false
            } catch {
                Write-Host ("PROBE_RESULT_PARSE_FAIL=" + $_.Exception.Message)
            }
        }
    }
    Write-Host 'PROBE_TIMEOUT no result file'
    return $false
}

function Read-Status {
    try {
        if (Test-Path $statusPath) {
            $raw = Get-Content -Raw -Path $statusPath -ErrorAction Stop
            if ($raw -and $raw.Trim()) { return ($raw | ConvertFrom-Json) }
        }
    } catch {}
    return $null
}

function Test-ProcessExists {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return $false }
    try {
        Get-Process -Id $ProcessId -ErrorAction Stop | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Read-WatchdogPid {
    try {
        if (Test-Path $watchdogPidPath) {
            $raw = (Get-Content -Raw -Path $watchdogPidPath).Trim()
            if ($raw) { return [int]$raw }
        }
    } catch {}
    return 0
}

function Test-CanDecryptToken {
    if (-not (Test-Path $tokenPath)) { return $false }
    try {
        $encrypted = (Get-Content -Raw $tokenPath).Trim()
        $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
        $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        return $true
    } catch {
        return $false
    }
}

function Write-KillRequest {
    param([string]$Reason, [string]$Sha)
    $payload = (@{
        reason = $Reason
        source_sha = $Sha
        requested_at = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json -Compress)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($requestPath, $payload, $utf8)
    Write-Host ("WATCHDOG_REFRESH_REQUEST=json source_sha=" + $Sha)
}

function Show-Diagnostics {
    param([string]$Label)
    Write-Host ("--- DIAG " + $Label + " ---")
    Write-Host ("DIAG_USER=" + [Environment]::UserName)
    Write-Host ("DIAG_TOKEN_DECRYPTABLE=" + (Test-CanDecryptToken))
    Write-Host ("DIAG_SOURCE_SHA=" + $sourceSha)
    Write-Host ("DIAG_CONFIG_EXISTS=" + (Test-Path $configPath))
    Write-Host ("DIAG_TOKEN_EXISTS=" + (Test-Path $tokenPath))
    Write-Host ("DIAG_AGENT_EXISTS=" + (Test-Path (Join-Path $runtimeDir 'aria-agent.js')))
    Write-Host ("DIAG_WATCHDOG_SCRIPT_EXISTS=" + (Test-Path $watchdogScript))
    if (Test-Path $runtimeShaPath) {
        Write-Host ("DIAG_RUNTIME_SHA=" + ((Get-Content -Raw $runtimeShaPath).Trim()))
    }
    if (Test-Path $configPath) {
        try {
            $cfg = Get-Content -Raw $configPath | ConvertFrom-Json
            Write-Host ("DIAG_DEVICE=" + $cfg.device_id)
            Write-Host ("DIAG_NODE_PATH=" + $cfg.node_path)
            Write-Host ("DIAG_NODE_EXISTS=" + (Test-Path ([string]$cfg.node_path)))
        } catch {
            Write-Host ("DIAG_CONFIG_PARSE_FAILED=" + $_.Exception.Message)
        }
    }
    try {
        $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
        Write-Host ("DIAG_LOGGED_ON=" + $cs.UserName)
    } catch {}
    if (Test-Path $tokenPath) {
        try {
            $encrypted = (Get-Content -Raw $tokenPath).Trim()
            $secure = $encrypted | ConvertTo-SecureString -ErrorAction Stop
            $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
            Write-Host 'DIAG_TOKEN_DECRYPT=PASS'
        } catch {
            Write-Host ("DIAG_TOKEN_DECRYPT=FAIL " + $_.Exception.Message)
        }
    }
    try {
        $statusRaw = if (Test-Path $statusPath) { Get-Content -Raw $statusPath } else { '' }
        Write-Host ("DIAG_STATUS=" + $statusRaw)
    } catch {
        Write-Host ("DIAG_STATUS_READ_FAILED=" + $_.Exception.Message)
    }
    Write-Host ("DIAG_WATCHDOG_PID_FILE=" + (Read-WatchdogPid))
    if (Test-Path $agentPidPath) {
        Write-Host ("DIAG_AGENT_PID_FILE=" + ((Get-Content -Raw $agentPidPath).Trim()))
    }
    try {
        $nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -like '*aria-agent.js*'
        }
        Write-Host ("DIAG_ARIA_NODE_COUNT=" + @($nodes).Count)
        foreach ($n in @($nodes)) { Write-Host ("DIAG_ARIA_NODE pid=" + $n.ProcessId) }
    } catch {
        Write-Host ("DIAG_ARIA_NODE_SCAN_FAILED=" + $_.Exception.Message)
    }
    try {
        $wps = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.CommandLine -and $_.CommandLine -like '*run-agent.ps1*'
        }
        foreach ($w in @($wps)) { Write-Host ("DIAG_WATCHDOG_PROCESS pid=" + $w.ProcessId) }
    } catch {
        Write-Host ("DIAG_WATCHDOG_PROCESS_SCAN_FAILED=" + $_.Exception.Message)
    }
    if (Test-Path $watchdogLogPath) {
        Write-Host '--- watchdog.log tail ---'
        Get-Content -Path $watchdogLogPath -Tail 40 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host 'DIAG_WATCHDOG_LOG=missing'
    }
    Write-Host ("--- END DIAG " + $Label + " ---")
}

function Start-WatchdogInInteractiveSession {
    Write-Host 'WATCHDOG_BOOTSTRAP_CPAU=START'

    $probeOk = Test-InteractiveUserProbe
    if (-not $probeOk) {
        Write-Host 'WATCHDOG_BOOTSTRAP_CPAU=PROBE_FAILED'
        return 0
    }
    Write-Host 'WATCHDOG_BOOTSTRAP_CPAU=PROBE_PASS'

    $ps = (Get-Command powershell.exe).Source
    $cmd = ('"{0}" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{1}"' -f $ps, $watchdogScript)
    $r = Invoke-CreateProcessAsUser -CommandLine $cmd -WorkingDirectory $runtimeDir -Label 'WATCHDOG'
    if (-not $r.Ok) {
        Write-Host ("WATCHDOG_CPAU_LAUNCH_FAIL error=" + $r.Error)
        return 0
    }
    Write-Host ("WATCHDOG_CPAU_LAUNCHED pid=" + $r.Pid)

    $wp = 0
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 2
        $wp = Read-WatchdogPid
        if ($wp -gt 0 -and (Test-ProcessExists -ProcessId $wp)) {
            Write-Host ("WATCHDOG_BOOTSTRAP_PID=" + $wp + " via=cpau")
            return $wp
        }
        if ($r.Pid -gt 0 -and (Test-ProcessExists -ProcessId $r.Pid)) {
            try {
                $proc = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $r.Pid) -ErrorAction SilentlyContinue
                if ($proc -and $proc.CommandLine -and $proc.CommandLine -like '*run-agent.ps1*') {
                    Write-Host ("WATCHDOG_BOOTSTRAP_PID=" + $r.Pid + " via=cpau_direct")
                    return $r.Pid
                }
            } catch {}
        }
        try {
            $live = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
                $_.CommandLine -and $_.CommandLine -like '*run-agent.ps1*'
            }
            if (@($live).Count -gt 0) {
                $cand = [int]$live[0].ProcessId
                if (Test-ProcessExists -ProcessId $cand) {
                    Write-Host ("WATCHDOG_BOOTSTRAP_PID=" + $cand + " via=process_scan")
                    return $cand
                }
            }
        } catch {}
    }
    Write-Host 'WATCHDOG_BOOTSTRAP_PID=0 via=cpau_timeout'
    return 0
}

function Start-WatchdogOwner {
    Write-Host 'WATCHDOG_BOOTSTRAP=START'
    if (-not (Test-Path $watchdogScript)) { throw ("Watchdog script missing: " + $watchdogScript) }
    $canDecrypt = Test-CanDecryptToken
    Write-Host ("WATCHDOG_TOKEN_DECRYPTABLE=" + $canDecrypt + " USER=" + [Environment]::UserName)
    if (-not $canDecrypt) {
        return Start-WatchdogInInteractiveSession
    }
    Start-Process -FilePath (Get-Command powershell.exe).Source -ArgumentList @(
        '-NoProfile',
        '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', $watchdogScript
    ) -WorkingDirectory $runtimeDir -WindowStyle Hidden | Out-Null
    Start-Sleep -Seconds 5
    $wp = Read-WatchdogPid
    Write-Host ("WATCHDOG_BOOTSTRAP_PID=" + $wp + " via=current_user")
    return $wp
}

function Stop-WatchdogOwner {
    param([int]$WatchdogProcessId)
    if ($WatchdogProcessId -gt 0 -and (Test-ProcessExists -ProcessId $WatchdogProcessId)) {
        try {
            Stop-Process -Id $WatchdogProcessId -Force -ErrorAction Stop
            Write-Host ("OLD_WATCHDOG_STOPPED pid=" + $WatchdogProcessId)
        } catch {
            Write-Host ("OLD_WATCHDOG_STOP_FAILED pid=" + $WatchdogProcessId + " err=" + $_.Exception.Message)
        }
    }
    try {
        $others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object {
            $_.ProcessId -ne $PID -and $_.CommandLine -and ($_.CommandLine -like '*run-agent.ps1*')
        }
        foreach ($p in @($others)) {
            try {
                Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction Stop
                Write-Host ("STALE_WATCHDOG_STOPPED pid=" + $p.ProcessId)
            } catch {
                Write-Host ("STALE_WATCHDOG_STOP_FAILED pid=" + $p.ProcessId + " err=" + $_.Exception.Message)
            }
        }
    } catch {
        Write-Host ("STALE_WATCHDOG_SCAN_FAILED=" + $_.Exception.Message)
    }
    Start-Sleep -Seconds 3
    try { Remove-Item -Path $watchdogPidPath -Force -ErrorAction SilentlyContinue } catch {}
}

function Wait-AgentRefresh {
    param([string]$BeforePid, [int]$TimeoutSeconds, [string]$PassLabel)
    for ($i = 0; $i -lt $TimeoutSeconds; $i++) {
        Start-Sleep -Seconds 1
        $s = Read-Status
        if ($s -and [string]$s.state -eq 'agent_running' -and -not [string]::IsNullOrWhiteSpace([string]$s.agent_pid) -and [string]$s.agent_pid -ne $BeforePid) {
            Write-Host ($PassLabel + " old=" + $BeforePid + " new=" + $s.agent_pid)
            return $true
        }
        if (($i % 15) -eq 14 -and $s) {
            Write-Host ("REFRESH_WAIT t=" + ($i + 1) + "s state=" + $s.state + " agent_pid=" + $s.agent_pid + " consecutive=" + $s.consecutive_errors + " last_error=" + $s.last_error + $s.error)
        }
    }
    return $false
}

if ([string]::IsNullOrWhiteSpace($sourceSha)) { throw 'ARIA_EXPECTED_SHA missing' }

Show-Diagnostics -Label 'BEFORE'

$s = Read-Status
$before = if ($s) { [string]$s.agent_pid } else { '' }
$watchdogPid = Read-WatchdogPid
$ownerAlive = ($watchdogPid -gt 0 -and (Test-ProcessExists -ProcessId $watchdogPid))
$canDecrypt = Test-CanDecryptToken
$ownerError = ''
if ($s) { $ownerError = [string]$s.last_error + [string]$s.error + [string]$s.state }
$ownerTokenBroken = ($ownerError -match 'Clave no válida|Key not valid|estado especificado|watchdog_error|watchdog_exiting')

if (-not $ownerAlive) {
    Write-Host 'WATCHDOG_OWNER=absent'
    $watchdogPid = Start-WatchdogOwner
} elseif (-not $canDecrypt -and $ownerTokenBroken) {
    Write-Host ("WATCHDOG_OWNER=broken_system_session pid=" + $watchdogPid + " replacing_with_interactive_user")
    Stop-WatchdogOwner -WatchdogProcessId $watchdogPid
    $watchdogPid = Start-WatchdogOwner
} else {
    Write-Host ("WATCHDOG_ALREADY_RUNNING_PID=" + $watchdogPid)
}

Write-KillRequest -Reason 'certification-source-refresh' -Sha $sourceSha
$refreshed = Wait-AgentRefresh -BeforePid $before -TimeoutSeconds 90 -PassLabel 'AGENT_REFRESHED=PASS'

if (-not $refreshed) {
    Write-Host 'AGENT_REFRESH_TIMEOUT forcing clean watchdog restart'
    Show-Diagnostics -Label 'BEFORE_FORCE_RESTART'
    Stop-WatchdogOwner -WatchdogProcessId $watchdogPid
    $watchdogPid = Start-WatchdogOwner
    $refreshed = Wait-AgentRefresh -BeforePid $before -TimeoutSeconds 90 -PassLabel 'AGENT_REFRESHED_AFTER_FORCE=PASS'
}

if (-not $refreshed) {
    Show-Diagnostics -Label 'FINAL'
    throw 'Watchdog did not recover Agent after runtime synchronization'
}

Show-Diagnostics -Label 'AFTER_PASS'
Write-Host 'WATCHDOG_REFRESH=PASS'
exit 0
