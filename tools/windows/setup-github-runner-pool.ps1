[CmdletBinding()]
param(
  [string]$Repository = 'https://github.com/Robvg9/aria-worker',
  [int]$Count = 2,
  [string]$Root = 'D:\GitHub-Runners\aria',
  [string]$RegistrationToken = $env:GITHUB_RUNNER_TOKEN
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'PowerShell must run as Administrator.'
  }
}

Assert-Admin
if ($Count -lt 1 -or $Count -gt 8) { throw 'Count must be between 1 and 8.' }
if ([string]::IsNullOrWhiteSpace($RegistrationToken)) {
  throw 'Set GITHUB_RUNNER_TOKEN or pass -RegistrationToken with a fresh repository runner registration token.'
}

New-Item -ItemType Directory -Force -Path $Root | Out-Null
$apiHeaders = @{ 'User-Agent' = 'ARIA-runner-pool-bootstrap' }
$release = Invoke-RestMethod -Uri 'https://api.github.com/repos/actions/runner/releases/latest' -Headers $apiHeaders
$asset = $release.assets | Where-Object { $_.name -match '^actions-runner-win-x64-.*\.zip$' } | Select-Object -First 1
if (-not $asset) { throw 'Could not locate the current Windows x64 GitHub Actions runner package.' }

$zip = Join-Path $Root ([IO.Path]::GetFileName($asset.browser_download_url))
if (-not (Test-Path $zip)) {
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zip -UseBasicParsing
}

for ($i = 1; $i -le $Count; $i++) {
  $name = ('aria-win-{0:D2}' -f $i)
  $dir = Join-Path $Root $name
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  $configured = Test-Path (Join-Path $dir '.runner')
  if (-not $configured) {
    if (-not (Test-Path (Join-Path $dir 'config.cmd'))) {
      Expand-Archive -Path $zip -DestinationPath $dir -Force
    }

    & (Join-Path $dir 'config.cmd') '--unattended' '--replace' '--url' $Repository '--token' $RegistrationToken '--name' $name '--labels' 'aria,windows,x64,aria-pool' '--work' '_work' '--runasservice' '--disableupdate'
    if ($LASTEXITCODE -ne 0) { throw "Runner configuration failed for $name (exit $LASTEXITCODE)." }
  }

  # Ensure the service is running after configuration.
  $services = Get-Service | Where-Object { $_.Name -like "actions.runner.*.$name" -or $_.DisplayName -like "GitHub Actions Runner ($name)*" }
  foreach ($svc in $services) {
    if ($svc.Status -ne 'Running') { Start-Service -Name $svc.Name }
  }

  Write-Host "RUNNER_POOL_MEMBER=READY name=$name path=$dir"
}

Write-Host ''
Write-Host 'ARIA GITHUB RUNNER POOL READY'
Write-Host "Repository: $Repository"
Write-Host "Count: $Count"
Write-Host "Root: $Root"
Write-Host 'Labels: aria,windows,x64,aria-pool'
