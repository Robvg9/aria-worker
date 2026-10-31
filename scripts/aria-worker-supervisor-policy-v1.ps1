function Get-ARIAWorkerSupervisorDecision {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [int]$ExitCode
    )

    if ($ExitCode -eq 0) {
        return 'stop'
    }

    return 'restart'
}
