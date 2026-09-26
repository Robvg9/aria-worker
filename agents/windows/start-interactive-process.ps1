param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath,

  [string]$Arguments = '',

  [string]$WorkingDirectory = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class AriaInteractiveLauncher
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize;
        public int dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool OpenProcessToken(
        IntPtr processHandle,
        uint desiredAccess,
        out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    public static extern bool DuplicateTokenEx(
        IntPtr existingToken,
        uint desiredAccess,
        IntPtr tokenAttributes,
        int impersonationLevel,
        int tokenType,
        out IntPtr primaryToken);

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CreateProcessWithTokenW(
        IntPtr token,
        uint logonFlags,
        string applicationName,
        StringBuilder commandLine,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFO startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr handle);

    public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    public const uint TOKEN_ASSIGN_PRIMARY = 0x0001;
    public const uint TOKEN_DUPLICATE = 0x0002;
    public const uint TOKEN_QUERY = 0x0008;
    public const uint TOKEN_ADJUST_DEFAULT = 0x0080;
    public const uint TOKEN_ADJUST_SESSIONID = 0x0100;
    public const uint LOGON_WITH_PROFILE = 0x00000001;

    public const int SecurityImpersonation = 2;
    public const int TokenPrimary = 1;
}
'@

function Get-InteractiveExplorer {
    $explorer = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction SilentlyContinue |
        ForEach-Object {
            $proc = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
            if ($proc -and $proc.SessionId -ne 0) { $proc }
        } |
        Select-Object -First 1

    if (-not $explorer) {
        throw 'WINDOWS_HUMAN_GATE_NO_INTERACTIVE_EXPLORER'
    }

    return $explorer
}

$explorer = Get-InteractiveExplorer
$processHandle = [AriaInteractiveLauncher]::OpenProcess(
    [AriaInteractiveLauncher]::PROCESS_QUERY_LIMITED_INFORMATION,
    $false,
    $explorer.Id
)

if ($processHandle -eq [IntPtr]::Zero) {
    throw "OpenProcess failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}

$sourceToken = [IntPtr]::Zero
$primaryToken = [IntPtr]::Zero

try {
    $desired =
        [AriaInteractiveLauncher]::TOKEN_ASSIGN_PRIMARY -bor
        [AriaInteractiveLauncher]::TOKEN_DUPLICATE -bor
        [AriaInteractiveLauncher]::TOKEN_QUERY -bor
        [AriaInteractiveLauncher]::TOKEN_ADJUST_DEFAULT -bor
        [AriaInteractiveLauncher]::TOKEN_ADJUST_SESSIONID

    if (-not [AriaInteractiveLauncher]::OpenProcessToken(
        $processHandle,
        $desired,
        [ref]$sourceToken
    )) {
        throw "OpenProcessToken failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    if (-not [AriaInteractiveLauncher]::DuplicateTokenEx(
        $sourceToken,
        $desired,
        [IntPtr]::Zero,
        [AriaInteractiveLauncher]::SecurityImpersonation,
        [AriaInteractiveLauncher]::TokenPrimary,
        [ref]$primaryToken
    )) {
        throw "DuplicateTokenEx failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    $si = New-Object AriaInteractiveLauncher+STARTUPINFO
    $si.cb = [Runtime.InteropServices.Marshal]::SizeOf($si)
    $si.lpDesktop = 'winsta0\default'

    $commandLine = New-Object System.Text.StringBuilder
    [void]$commandLine.Append('"')
    [void]$commandLine.Append($FilePath)
    [void]$commandLine.Append('"')
    if (-not [string]::IsNullOrWhiteSpace($Arguments)) {
        [void]$commandLine.Append(' ')
        [void]$commandLine.Append($Arguments)
    }

    $pi = New-Object AriaInteractiveLauncher+PROCESS_INFORMATION

    if (-not [AriaInteractiveLauncher]::CreateProcessWithTokenW(
        $primaryToken,
        [AriaInteractiveLauncher]::LOGON_WITH_PROFILE,
        $null,
        $commandLine,
        0,
        [IntPtr]::Zero,
        $WorkingDirectory,
        [ref]$si,
        [ref]$pi
    )) {
        throw "CreateProcessWithTokenW failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
    }

    Write-Output "INTERACTIVE_PROCESS_PID=$($pi.dwProcessId)"
    Write-Output "INTERACTIVE_SOURCE_PID=$($explorer.Id)"
    Write-Output "INTERACTIVE_SESSION_ID=$($explorer.SessionId)"
}
finally {
    if ($primaryToken -ne [IntPtr]::Zero) {
        [void][AriaInteractiveLauncher]::CloseHandle($primaryToken)
    }

    if ($sourceToken -ne [IntPtr]::Zero) {
        [void][AriaInteractiveLauncher]::CloseHandle($sourceToken)
    }

    if ($processHandle -ne [IntPtr]::Zero) {
        [void][AriaInteractiveLauncher]::CloseHandle($processHandle)
    }
}
