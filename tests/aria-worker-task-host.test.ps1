$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot '..\scripts\aria-worker-task-host.cs'
$root = Join-Path $env:RUNNER_TEMP ('aria-task-host-test-' + [guid]::NewGuid().ToString('N'))
$exe = Join-Path $root 'aria-worker-task-host.exe'
$log = Join-Path $root 'self-test.log'
$compilerCandidates = @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $compiler) { throw 'No .NET Framework C# compiler was found.' }
if (-not (Test-Path -LiteralPath $source)) { throw "Task host source missing: $source" }

New-Item -ItemType Directory -Path $root -Force | Out-Null

try {
    & $compiler /nologo /target:winexe /platform:anycpu /optimize+ ("/out:" + $exe) $source
    if ($LASTEXITCODE -ne 0) {
        throw "Task host compilation failed with exit code $LASTEXITCODE."
    }
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Compiled task host executable was not created.' }

    # Verify PE OptionalHeader.Subsystem == IMAGE_SUBSYSTEM_WINDOWS_GUI (2).
    $stream = [System.IO.File]::OpenRead($exe)
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

    $process = Start-Process -FilePath $exe -ArgumentList ('--self-test "' + $log + '"') -PassThru -Wait

    if ($process.ExitCode -ne 0) {
        if (Test-Path $log) { Get-Content -LiteralPath $log }
        throw "Task host no-console self-test failed: exit $($process.ExitCode)."
    }

    if (-not (Test-Path -LiteralPath $log)) { throw 'Task host self-test did not create its log.' }

    $content = Get-Content -LiteralPath $log -Raw
    foreach ($marker in @(
        'SELFTEST_HOST_CONSOLE=NONE',
        'CHILD_CONSOLE=NONE',
        'SELFTEST_CHILD_EXIT_CODE=0',
        'SELFTEST_RESULT=PASS'
    )) {
        if (-not $content.Contains($marker)) {
            Get-Content -LiteralPath $log
            throw "Task host self-test missing marker: $marker"
        }
    }

    Write-Output 'TASK_HOST_PROCESS_CONSOLE=NONE_PASS'
    Write-Output 'TASK_HOST_CHILD_POWERSHELL_CONSOLE=NONE_PASS'
    Write-Output 'TASK_HOST_NO_CONSOLE_SELFTEST=PASS'
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
