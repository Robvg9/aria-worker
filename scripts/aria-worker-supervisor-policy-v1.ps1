function Get-ARIAWorkerSupervisorDecision {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$ExitCode,

        [int]$RestartCount = 0,

        [int]$MaxRestarts = 5
    )

    if ($ExitCode -eq 0) {
        return 'stop'
    }

    if ($MaxRestarts -lt 0 -or $RestartCount -ge $MaxRestarts) {
        return 'exhausted'
    }

    return 'restart'
}

function Get-ARIAWorkerSupervisorDelaySeconds {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [ValidateRange(0, 20)]
        [int]$RestartCount
    )

    return [int][Math]::Min(60, 5 * [Math]::Pow(2, $RestartCount))
}
