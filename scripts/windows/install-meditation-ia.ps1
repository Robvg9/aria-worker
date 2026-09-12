param([string]$RuntimeRoot='D:\ARIA-Windows-Agent')
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtime=Join-Path $RuntimeRoot 'Runtime\windows';$autonomy=Join-Path $RuntimeRoot 'autonomy';$med=Join-Path $RuntimeRoot 'Runtime\meditation'
New-Item -ItemType Directory -Force -Path $runtime,$autonomy,$med|Out-Null
Copy-Item (Join-Path $repo 'autonomy\meditation-ia-controller.js') (Join-Path $autonomy 'meditation-ia-controller.js') -Force
Copy-Item (Join-Path $repo 'autonomy\meditation-ia-policy.js') (Join-Path $autonomy 'meditation-ia-policy.js') -Force
Copy-Item (Join-Path $repo 'agents\windows\aria-meditation-controller.js') (Join-Path $runtime 'aria-meditation-controller.js') -Force
Copy-Item (Join-Path $repo 'agents\windows\aria-meditation-ui.ps1') (Join-Path $runtime 'aria-meditation-ui.ps1') -Force
$cmd=Join-Path $runtime 'aria-meditation-ui.cmd';Set-Content -Path $cmd -Encoding ASCII -Value @('@echo off',"powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runtime\aria-meditation-ui.ps1`"")
Write-Host 'ARIA_MEDITATION_INSTALL=PASS';Write-Host "UI=$cmd";Write-Host "LOG=$med\ARIA-Meditation-IA.txt"
