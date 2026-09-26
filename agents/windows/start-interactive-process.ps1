param(
  [Parameter(Mandatory = $true)]
  [string]$FilePath,

  [string]$Arguments = '',

  [string]$WorkingDirectory = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'

function Get-InteractiveUser {
  $explorer = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -ne 0 } |
    Select-Object -First 1

  if (-not $explorer) {
    throw 'WINDOWS_HUMAN_GATE_NO_INTERACTIVE_EXPLORER'
  }

  $computer = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
  $userId = [string]$computer.UserName

  if ([string]::IsNullOrWhiteSpace($userId)) {
    # Fallback: query the interactive session through QUSER.
    $quser = & quser.exe 2>$null
    if ($LASTEXITCODE -eq 0 -and $quser) {
      $line = $quser | Select-Object -Skip 1 | Where-Object { $_ -match '\S' } | Select-Object -First 1
      if ($line -match '^\s*>?\s*(\S+)\s+(\S+)') {
        $userId = $Matches[1]
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($userId)) {
    throw 'WINDOWS_HUMAN_GATE_NO_INTERACTIVE_USER'
  }

  [pscustomobject]@{
    UserId = $userId
    SessionId = [int]$explorer.SessionId
    ExplorerPid = [int]$explorer.ProcessId
  }
}

$user = Get-InteractiveUser
$taskName = 'ARIA-Interactive-Launcher'

$service = New-Object -ComObject 'Schedule.Service'
$service.Connect()

$rootFolder = $service.GetFolder('\')
$taskDefinition = $service.NewTask(0)

$taskDefinition.RegistrationInfo.Description = 'ARIA launches a process in the currently logged-in interactive Windows session.'
$taskDefinition.Settings.Enabled = $true
$taskDefinition.Settings.StartWhenAvailable = $true
$taskDefinition.Settings.AllowDemandStart = $true
$taskDefinition.Settings.MultipleInstances = 0

# TASK_LOGON_INTERACTIVE_TOKEN = 3
$taskDefinition.Principal.UserId = $user.UserId
$taskDefinition.Principal.LogonType = 3
# TASK_RUNLEVEL_HIGHEST = 1
$taskDefinition.Principal.RunLevel = 1

$action = $taskDefinition.Actions.Create(0)
$action.Path = $FilePath
$action.Arguments = $Arguments
$action.WorkingDirectory = $WorkingDirectory

# TASK_CREATE_OR_UPDATE = 6
# TASK_LOGON_INTERACTIVE_TOKEN = 3
$rootFolder.RegisterTaskDefinition(
  $taskName,
  $taskDefinition,
  6,
  $user.UserId,
  $null,
  3,
  $null
) | Out-Null

$task = $rootFolder.GetTask("\$taskName")
$runningInstance = $task.Run($null, 0)

Write-Output "INTERACTIVE_TASK_NAME=$taskName"
Write-Output "INTERACTIVE_PROCESS_ID=$($runningInstance.InstanceGuid)"
Write-Output "INTERACTIVE_USER=$($user.UserId)"
Write-Output "INTERACTIVE_SESSION_ID=$($user.SessionId)"
Write-Output "INTERACTIVE_SOURCE_PID=$($user.ExplorerPid)"
