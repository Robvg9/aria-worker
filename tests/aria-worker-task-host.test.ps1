$ErrorActionPreference = 'Stop'

$hostSource = Join-Path $PSScriptRoot '..\scripts\aria-worker-task-host.cs'
$probeSource = Join-Path $PSScriptRoot '..\scripts\aria-worker-console-probe.cs'
$root = Join-Path $env:RUNNER_TEMP ('aria-task-host-test-' + [guid]::NewGuid().ToString('N'))
$hostExe = Join-Path $root 'aria-worker-task-host.exe'
$probeExe = Join-Path $root 'aria-console-probe.exe'
$detachLog = Join-Path $root 'detached-process-self-test.log'
$dpapiLog = Join-Path $root 'dpapi-self-test.log'

$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates |
    Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
    Select-Object -First 1

if (-not $compiler) { throw 'No .NET Framework C# compiler was found.' }
foreach ($source in @($hostSource, $probeSource)) {
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Task host test source missing: $source"
    }
}

New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
    & $compiler /nologo /reference:System.Security.dll /reference:System.Web.Extensions.dll /target:winexe /platform:anycpu /optimize+ ("/out:" + $hostExe) $hostSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe)) {
        throw "Task host compilation failed with exit code $LASTEXITCODE."
    }

    & $compiler /nologo /target:exe /platform:anycpu /optimize+ ("/out:" + $probeExe) $probeSource
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $probeExe)) {
        throw "Console probe compilation failed with exit code $LASTEXITCODE."
    }

    # Verify PE OptionalHeader.Subsystem == IMAGE_SUBSYSTEM_WINDOWS_GUI (2).
    $stream = [System.IO.File]::OpenRead($hostExe)
    try {
        $reader = New-Object System.IO.BinaryReader($stream)
        $stream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw 'Invalid PE signature.' }
        $stream.Position = $peOffset + 4 + 20 + 68
        $subsystem = $reader.ReadUInt16()
    }
    finally {
        $stream.Dispose()
    }

    if ($subsystem -ne 2) {
        throw "Task host is not a Windows GUI-subsystem executable (subsystem=$subsystem)."
    }
    Write-Output 'TASK_HOST_PE_SUBSYSTEM=WINDOWS_GUI_PASS'

    # Verify that the GUI host has no console and its console-subsystem child is
    # created with DETACHED_PROCESS (not CREATE_NO_WINDOW).
    $detachArgs = '--self-test-detach "' + $probeExe + '" "' + $detachLog + '"'
    $detachProcess = Start-Process -FilePath $hostExe -ArgumentList $detachArgs -PassThru -Wait

    if ($detachProcess.ExitCode -ne 0) {
        if (Test-Path -LiteralPath $detachLog) { Get-Content -LiteralPath $detachLog }
        throw "DETACHED_PROCESS self-test failed with exit code $($detachProcess.ExitCode)."
    }

    $detachContent = Get-Content -LiteralPath $detachLog -Raw
    foreach ($marker in @(
        'SELFTEST_HOST_CONSOLE=NONE',
        'DETACHED_CHILD_CONSOLE=NONE',
        'SELFTEST_DETACHED_CHILD_EXIT_CODE=0',
        'SELFTEST_RESULT=PASS'
    )) {
        if (-not $detachContent.Contains($marker)) {
            Get-Content -LiteralPath $detachLog
            throw "DETACHED_PROCESS test missing marker: $marker"
        }
    }

    Write-Output 'TASK_HOST_PROCESS_CONSOLE=NONE_PASS'
    Write-Output 'TASK_HOST_DETACHED_CONSOLE_CHILD=PASS'

    # Verify compatibility with ConvertFrom-SecureString DPAPI output.
    $testToken = 'aria-task-host-dpapi-ci-' + [guid]::NewGuid().ToString('N') + '-token'
    $secure = ConvertTo-SecureString -String $testToken -AsPlainText -Force

    try {
        $encrypted = ConvertFrom-SecureString -SecureString $secure
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $hashBytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($testToken))
            $expectedHash = [BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
            [Array]::Clear($hashBytes, 0, $hashBytes.Length)
        }
        finally {
            $sha.Dispose()
        }

        $dpapiArgs = '--self-test-dpapi "' + $encrypted + '" "' + $expectedHash + '" "' + $dpapiLog + '"'
        $dpapiProcess = Start-Process -FilePath $hostExe -ArgumentList $dpapiArgs -PassThru -Wait

        if ($dpapiProcess.ExitCode -ne 0) {
            if (Test-Path -LiteralPath $dpapiLog) { Get-Content -LiteralPath $dpapiLog }
            throw "DPAPI host round-trip self-test failed with exit code $($dpapiProcess.ExitCode)."
        }

        $dpapiContent = Get-Content -LiteralPath $dpapiLog -Raw
        if (-not $dpapiContent.Contains('SELFTEST_DPAPI_ROUNDTRIP=PASS') -or
            -not $dpapiContent.Contains('SELFTEST_DPAPI_PLAINTEXT_LOGGED=NO')) {
            Get-Content -LiteralPath $dpapiLog
            throw 'DPAPI host test did not report a safe successful round-trip.'
        }

        if ($dpapiContent.Contains($testToken)) {
            throw 'DPAPI self-test log unexpectedly contains plaintext test token.'
        }

        Write-Output 'TASK_HOST_DPAPI_CURRENT_USER_ROUNDTRIP=PASS'
        Write-Output 'TASK_HOST_DPAPI_PLAINTEXT_NOT_LOGGED=PASS'

        # Exercise the exact JSON config contract used by the Windows worker installer.
        $workspace = Join-Path $root 'workspace'
        New-Item -ItemType Directory -Path $workspace -Force | Out-Null
        $fixture = Join-Path $PSScriptRoot '..\tests\fixtures\aria-frozen-worker-probe-adapter.js'
        if (-not (Test-Path -LiteralPath $fixture -PathType Leaf)) {
            throw "Frozen adapter fixture missing: $fixture"
        }

        $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $configPath = Join-Path $root 'worker.config.json'
        $document = [ordered]@{
            format = 'aria-worker-config-dpapi-v1'
            protectedForSid = $sid
            createdAtUtc = [DateTime]::UtcNow.ToString('o')
            workerTokenDpapi = $encrypted
            values = [ordered]@{
                ARIA_CONTROL_URL = 'https://aria-autonomy-coordinator.robvg9.workers.dev'
                ARIA_AUTONOMY_ADAPTER = (Resolve-Path -LiteralPath $fixture).Path
                ARIA_WORKSPACE_ROOT = $workspace
                ARIA_WORKER_ID = 'aria-task-host-ci-safe-fixture'
                ARIA_WORKER_POLL_MS = '1000'
                ARIA_WORKER_HEARTBEAT_MS = '15000'
            }
        }

        $json = $document | ConvertTo-Json -Depth 6
        [System.IO.File]::WriteAllText($configPath, $json, ([System.Text.UTF8Encoding]::new($false)))
        $configArgs = '--self-test-config "' + $configPath + '" "' + $dpapiLog + '"'
        $configProcess = Start-Process -FilePath $hostExe -ArgumentList $configArgs -PassThru -Wait

        if ($configProcess.ExitCode -ne 0) {
            Get-Content -LiteralPath $dpapiLog
            throw "DPAPI config host self-test failed with exit code $($configProcess.ExitCode)."
        }

        $configContent = Get-Content -LiteralPath $dpapiLog -Raw
        if (-not $configContent.Contains('SELFTEST_CONFIG_DPAPI=PASS') -or
            -not $configContent.Contains('SELFTEST_CONFIG_TOKEN_LOGGED=NO') -or
            $configContent.Contains($testToken)) {
            Get-Content -LiteralPath $dpapiLog
            throw 'DPAPI config test did not pass or token appeared in output.'
        }

        Write-Output 'TASK_HOST_DPAPI_CONFIG_FORMAT=PASS'
    }
    finally {
        $testToken = $null
        $secure.Dispose()
    }

    Write-Output 'TASK_HOST_DETACHED_PROCESS_CONTRACT=PASS'
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
