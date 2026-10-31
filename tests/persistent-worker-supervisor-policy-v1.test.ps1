$ErrorActionPreference = 'Stop'

$policyPath = Join-Path $PSScriptRoot '..\scripts\aria-worker-supervisor-policy-v1.ps1'
$supervisorPath = Join-Path $PSScriptRoot '..\scripts\Start-ARIA-Persistent-Worker.ps1'
. $policyPath

$cases = @(
    [pscustomobject]@{ ExitCode = 0; Expected = 'stop' },
    [pscustomobject]@{ ExitCode = 1; Expected = 'restart' },
    [pscustomobject]@{ ExitCode = 2; Expected = 'restart' },
    [pscustomobject]@{ ExitCode = 75; Expected = 'restart' }
)

foreach ($case in $cases) {
    $actual = Get-ARIAWorkerSupervisorDecision -ExitCode $case.ExitCode
    if ($actual -cne $case.Expected) {
        throw "Exit code $($case.ExitCode): expected $($case.Expected), received $actual."
    }
}

$supervisor = Get-Content -LiteralPath $supervisorPath -Raw
if ($supervisor -notmatch 'Get-ARIAWorkerSupervisorDecision\s+-ExitCode\s+\$exitCode') {
    throw 'Supervisor does not apply the tested exit policy.'
}
if ($supervisor -notmatch 'supervisor stopping without restart') {
    throw 'Supervisor clean-stop branch is missing its terminal log marker.'
}

Write-Output 'WINDOWS_WORKER_SUPERVISOR_EXIT_POLICY=PASS'
Write-Output 'WINDOWS_WORKER_EXIT_0_STOPS_WITHOUT_RESTART=PASS'
