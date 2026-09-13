param([string]$RuntimeRoot='D:\ARIA-Windows-Agent')
$ErrorActionPreference='Stop'
$repo=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtime=Join-Path $RuntimeRoot 'Runtime\windows';$autonomy=Join-Path $RuntimeRoot 'autonomy';$med=Join-Path $RuntimeRoot 'Runtime\meditation';$scripts=Join-Path $RuntimeRoot 'Runtime\scripts'
New-Item -ItemType Directory -Force -Path $runtime,$autonomy,$med,$scripts|Out-Null
Copy-Item (Join-Path $repo 'autonomy\meditation-ia-controller.js') (Join-Path $autonomy 'meditation-ia-controller.js') -Force
Copy-Item (Join-Path $repo 'autonomy\meditation-ia-policy.js') (Join-Path $autonomy 'meditation-ia-policy.js') -Force
Copy-Item (Join-Path $repo 'agents\windows\aria-meditation-controller.js') (Join-Path $runtime 'aria-meditation-controller.js') -Force
Copy-Item (Join-Path $repo 'agents\windows\aria-meditation-ui.ps1') (Join-Path $runtime 'aria-meditation-ui.ps1') -Force
Copy-Item (Join-Path $repo 'scripts\windows\start-meditation-ia.ps1') (Join-Path $scripts 'start-meditation-ia.ps1') -Force
$cmd=Join-Path $runtime 'aria-meditation-ui.cmd';Set-Content -Path $cmd -Encoding ASCII -Value @('@echo off',"powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scripts\start-meditation-ia.ps1`"")
$desktop=$null
try {
  $desktop=Join-Path ([Environment]::GetFolderPath('Desktop')) 'ARIA — Meditación IA.lnk'
  $shell=New-Object -ComObject WScript.Shell
  $shortcut=$shell.CreateShortcut($desktop)
  $shortcut.TargetPath='powershell.exe'
  $shortcut.Arguments="-NoProfile -ExecutionPolicy Bypass -File `"$scripts\start-meditation-ia.ps1`""
  $shortcut.WorkingDirectory=$RuntimeRoot
  $shortcut.WindowStyle=1
  $shortcut.Description='ARIA — activar y controlar Meditación IA'
  $shortcut.Save()
} catch { Write-Host "DESKTOP_SHORTCUT=SKIPPED reason=$($_.Exception.Message)" }
Write-Host 'ARIA_MEDITATION_INSTALL=PASS';Write-Host "UI=$cmd";Write-Host "LAUNCHER=$scripts\start-meditation-ia.ps1";Write-Host "LOG=$med\ARIA-Meditation-IA.txt";if($desktop){Write-Host "DESKTOP_SHORTCUT=$desktop"}
