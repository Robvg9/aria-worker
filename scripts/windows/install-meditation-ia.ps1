param(
  [string]$RuntimeRoot = 'D:\ARIA-Windows-Agent',
  [string]$NodePath = 'D:\Databank\node\node.exe'
)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $RuntimeRoot 'Runtime\windows'
$autonomy = Join-Path $RuntimeRoot 'autonomy'
New-Item -ItemType Directory -Force -Path $runtime,$autonomy | Out-Null
Copy-Item (Join-Path $PSScriptRoot '..\..\autonomy\meditation-ia-controller.js') (Join-Path $autonomy 'meditation-ia-controller.js') -Force
Copy-Item (Join-Path $PSScriptRoot '..\..\autonomy\meditation-ia-policy.js') (Join-Path $autonomy 'meditation-ia-policy.js') -Force
Copy-Item (Join-Path $PSScriptRoot '..\..\agents\windows\aria-meditation-controller.js') (Join-Path $runtime 'aria-meditation-controller.js') -Force
Copy-Item (Join-Path $PSScriptRoot '..\..\agents\windows\aria-meditation-ui.ps1') (Join-Path $runtime 'aria-meditation-ui.ps1') -Force
$wrapper = Join-Path $runtime 'aria-meditation-ui.cmd'
@('@echo off', "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runtime\aria-meditation-ui.ps1`"") | Set-Content -Path $wrapper -Encoding ASCII
Write-Host 'ARIA_MEDITATION_INSTALL=PASS'
Write-Host "CONTROL_UI=$wrapper"
Write-Host 'Restart the existing ARIA Windows Agent after syncing agents/windows/aria-agent.js.'
