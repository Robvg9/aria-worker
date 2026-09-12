param([int]$Port = 45873)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$base = "http://127.0.0.1:$Port"
function Invoke-Aria([string]$Path) { try { Invoke-RestMethod -Method Post -Uri "$base$Path" -TimeoutSec 5 | Out-Null } catch {} }
function Get-Status { try { Invoke-RestMethod -Method Get -Uri "$base/status" -TimeoutSec 3 } catch { $null } }
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ARIA — Meditación IA'; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(560,400)
$title = New-Object System.Windows.Forms.Label; $title.Text='ARIA — MEDITACIÓN IA'; $title.Font=New-Object System.Drawing.Font('Segoe UI',16,[System.Drawing.FontStyle]::Bold); $title.AutoSize=$true; $title.Location=New-Object System.Drawing.Point(25,20); $form.Controls.Add($title)
$status = New-Object System.Windows.Forms.Label; $status.AutoSize=$true; $status.Location=New-Object System.Drawing.Point(28,65); $form.Controls.Add($status)
$goal = New-Object System.Windows.Forms.Label; $goal.AutoSize=$false; $goal.Size=New-Object System.Drawing.Size(490,55); $goal.Location=New-Object System.Drawing.Point(28,95); $form.Controls.Add($goal)
$log = New-Object System.Windows.Forms.TextBox; $log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'; $log.Location=New-Object System.Drawing.Point(28,155); $log.Size=New-Object System.Drawing.Size(490,120); $form.Controls.Add($log)
$items=@(@{t='INICIAR';x=28;p='/start'},@{t='PAUSAR';x=150;p='/pause'},@{t='AVANZA';x=272;p='/resume'},@{t='CERRAR';x=394;p='/stop'})
foreach($i in $items){$b=New-Object System.Windows.Forms.Button;$b.Text=$i.t;$b.Size=New-Object System.Drawing.Size(105,40);$b.Location=New-Object System.Drawing.Point($i.x,295);$p=$i.p;$b.Add_Click({Invoke-Aria $p;Refresh-Ui});$form.Controls.Add($b)}
function Refresh-Ui { $s=Get-Status; if($null -eq $s){$status.Text='● ARIA Agent no responde';return};$status.Text="● Modo: $($s.mode)    Tick: $($s.tick_count)";$goal.Text="Objetivo: $([string]$s.active_goal)";try{$r=Invoke-RestMethod -Method Get -Uri "$base/log" -TimeoutSec 3;$log.Text=((([string]$r.content)-split "`r?`n")|Where-Object{$_}|Select-Object -Last 14)-join [Environment]::NewLine;$log.SelectionStart=$log.TextLength;$log.ScrollToCaret()}catch{}}
$timer=New-Object System.Windows.Forms.Timer;$timer.Interval=3000;$timer.Add_Tick({Refresh-Ui});$timer.Start();Refresh-Ui;[void]$form.ShowDialog()
