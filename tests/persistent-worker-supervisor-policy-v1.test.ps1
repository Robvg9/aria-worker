$ErrorActionPreference = 'Stop'

$policyPath = Join-Path $PSScriptRoot '..\scripts\aria-worker-supervisor-policy-v1.ps1'
$supervisorPath = Join-Path $PSScriptRoot '..\scripts\Start-ARIA-Persistent-Worker.ps1'
. $policyPath

$cases = @(
    [pscustomobject]@{ ExitCode = 0; RestartCount = 0; Expected = 'stop' },
    [pscustomobject]@{ ExitCode = 1; RestartCount = 0; Expected = 'restart' },
    [pscustomobject]@{ ExitCode = 2; RestartCount = 4; Expected = 'restart' },
    [pscustomobject]@{ ExitCode = 75; RestartCount = 5; Expected = 'exhausted' },
    [pscustomobject]@{ ExitCode = 1; RestartCount = 5; Expected = 'exhausted' }
)

foreach ($case in $cases) {
    $actual = Get-ARIAWorkerSupervisorDecision -ExitCode $case.ExitCode -RestartCount $case.RestartCount -MaxRestarts 5
    if ($actual -cne $case.Expected) {
        throw "Exit code $($case.ExitCode), restart count $($case.RestartCount): expected $($case.Expected), received $actual."
    }
}

$expectedDelays = @(5, 10, 20, 40, 60)
for ($index = 0; $index -lt $expectedDelays.Count; $index += 1) {
    $actualDelay = Get-ARIAWorkerSupervisorDelaySeconds -RestartCount $index
    if ($actualDelay -ne $expectedDelays[$index]) {
        throw "Restart $index: expected delay $($expectedDelays[$index]), received $actualDelay."
    }
}

$supervisor = Get-Content -LiteralPath $supervisorPath -Raw
if ($supervisor -notmatch 'Get-ARIAWorkerSupervisorDecision\s+-ExitCode\s+\$exitCode') {
    throw 'Supervisor does not apply the tested exit policy.'
}
if ($supervisor -notmatch 'supervisor stopping without restart') {
    throw 'Supervisor clean-stop branch is missing its terminal log marker.'
}
if ($supervisor -notmatch 'ARIA_WORKER_SUPERVISOR_RETRIES_EXHAUSTED') {
    throw 'Supervisor does not stop after its bounded retry budget.'
}
if ($supervisor -notmatch 'Get-ARIAWorkerSupervisorDelaySeconds') {
    throw 'Supervisor does not use the tested bounded backoff schedule.'
}

Write-Output 'WINDOWS_WORKER_SUPERVISOR_EXIT_POLICY=PASS'
Write-Output 'WINDOWS_WORKER_EXIT_0_STOPS_WITHOUT_RESTART=PASS'
Write-Output 'WINDOWS_WORKER_RESTART_BUDGET_MAX=5'
Write-Output 'WINDOWS_WORKER_EXPONENTIAL_BACKOFF=5,10,20,40,60'
