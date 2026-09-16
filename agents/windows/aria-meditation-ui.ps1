param([int]$Port = 45873)
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$base = "http://127.0.0.1:$Port"
$heartbeatSeconds = 30
function Get-Status { try { Invoke-RestMethod -Method Get -Uri "$base/status" -TimeoutSec 3 -ErrorAction Stop } catch { $null } }
function Get-ActivityLog { try { Invoke-RestMethod -Method Get -Uri "$base/log" -TimeoutSec 3 -ErrorAction Stop } catch { $null } }
function Set-CommandResult([string]$text, [bool]$error = $false) {
    $commandResult.Text = $text
    if($error){$commandResult.ForeColor=[System.Drawing.Color]::Firebrick}else{$commandResult.ForeColor=[System.Drawing.Color]::DarkGreen}
}
function Invoke-Aria([string]$path) {
    try {
        $button = $null
        foreach($control in $form.Controls){ if($control -is [System.Windows.Forms.Button] -and [string]$control.Tag -eq $path){$button=$control;break} }
        if($null -ne $button){$button.Enabled=$false}
        Set-CommandResult("Enviando $path ...", $false)
        $result = Invoke-RestMethod -Method Post -Uri "$base$path" -TimeoutSec 15 -ErrorAction Stop
        $state = $result.state
        if($null -ne $state){
            $modeValue=[string]$state.mode
            if([string]::IsNullOrWhiteSpace($modeValue)){$modeValue='UNKNOWN'}
            Set-CommandResult("OK: $path -> $([string]$result.status) | Modo: $modeValue | Sesion: $([string]$state.session_id)", $false)
        } else {
            Set-CommandResult("OK: $path -> $([string]$result.status)", $false)
        }
        Refresh-Ui
        return $result
    } catch {
        Set-CommandResult("ERROR: $path -> $($_.Exception.Message)", $true)
        try { Refresh-Ui } catch {}
        return $null
    } finally {
        if($null -ne $button){$button.Enabled=$true}
    }
}
$form = New-Object System.Windows.Forms.Form
$form.Text = 'ARIA - Meditacion IA'; $form.StartPosition = 'CenterScreen'; $form.Size = New-Object System.Drawing.Size(900,720); $form.MinimumSize = New-Object System.Drawing.Size(900,720); $form.MaximizeBox=$false; $form.Font=New-Object System.Drawing.Font('Segoe UI',10)
$title=New-Object System.Windows.Forms.Label; $title.Text='ARIA - MEDITACION IA'; $title.Font=New-Object System.Drawing.Font('Segoe UI',20,[System.Drawing.FontStyle]::Bold); $title.AutoSize=$true; $title.Location=New-Object System.Drawing.Point(28,18); $form.Controls.Add($title)
$status=New-Object System.Windows.Forms.Label; $status.AutoSize=$false; $status.Size=New-Object System.Drawing.Size(820,32); $status.Font=New-Object System.Drawing.Font('Segoe UI',12,[System.Drawing.FontStyle]::Bold); $status.Location=New-Object System.Drawing.Point(30,82); $form.Controls.Add($status)
$mode=New-Object System.Windows.Forms.Label; $mode.AutoSize=$false; $mode.Size=New-Object System.Drawing.Size(400,55); $mode.Location=New-Object System.Drawing.Point(30,120); $form.Controls.Add($mode)
$mission=New-Object System.Windows.Forms.Label; $mission.AutoSize=$false; $mission.Size=New-Object System.Drawing.Size(400,55); $mission.Location=New-Object System.Drawing.Point(445,120); $form.Controls.Add($mission)
$progress=New-Object System.Windows.Forms.Label; $progress.AutoSize=$false; $progress.Size=New-Object System.Drawing.Size(820,48); $progress.Font=New-Object System.Drawing.Font('Segoe UI',10,[System.Drawing.FontStyle]::Bold); $progress.Location=New-Object System.Drawing.Point(30,180); $form.Controls.Add($progress)
$telemetry=New-Object System.Windows.Forms.Label; $telemetry.AutoSize=$false; $telemetry.Size=New-Object System.Drawing.Size(820,72); $telemetry.Location=New-Object System.Drawing.Point(30,228); $form.Controls.Add($telemetry)
$next=New-Object System.Windows.Forms.Label; $next.AutoSize=$false; $next.Size=New-Object System.Drawing.Size(820,36); $next.Location=New-Object System.Drawing.Point(30,302); $form.Controls.Add($next)
$commandResult=New-Object System.Windows.Forms.Label; $commandResult.AutoSize=$false; $commandResult.Size=New-Object System.Drawing.Size(820,32); $commandResult.Font=New-Object System.Drawing.Font('Consolas',9,[System.Drawing.FontStyle]::Bold); $commandResult.Location=New-Object System.Drawing.Point(30,332); $form.Controls.Add($commandResult)
$log=New-Object System.Windows.Forms.TextBox; $log.Multiline=$true; $log.ReadOnly=$true; $log.ScrollBars='Vertical'; $log.Font=New-Object System.Drawing.Font('Consolas',9); $log.Location=New-Object System.Drawing.Point(30,368); $log.Size=New-Object System.Drawing.Size(820,205); $form.Controls.Add($log)
$buttons=@(@{t='ACTIVAR';x=30;p='/start'},@{t='PAUSAR';x=225;p='/pause'},@{t='CONTINUAR';x=420;p='/resume'},@{t='DETENER';x=615;p='/stop'})
foreach($item in $buttons){$button=New-Object System.Windows.Forms.Button;$button.Text=$item.t;$button.Font=New-Object System.Drawing.Font('Segoe UI',10,[System.Drawing.FontStyle]::Bold);$button.Size=New-Object System.Drawing.Size(175,48);$button.Location=New-Object System.Drawing.Point($item.x,620);$button.Tag=$item.p;$button.Add_Click({try{[void](Invoke-Aria ([string]$this.Tag))}catch{Set-CommandResult("ERROR: $($_.Exception.Message)",$true)}});$form.Controls.Add($button)}
function Apply-Status($s) {
    if($null -eq $s){$status.Text='[OFFLINE] ARIA Local Agent no responde';$mode.Text='Modo: -';$mission.Text='Mision: -';$progress.Text='Progreso: -';$telemetry.Text='Telemetria: sin datos';$next.Text='Proxima accion: -';return}
    $modeValue = [string]$s.mode
    if([string]::IsNullOrWhiteSpace($modeValue)){$modeValue='UNKNOWN'}
    $status.Text="[ONLINE] Modo: $($modeValue.ToUpperInvariant())"
    $mode.Text="Modo: $modeValue`r`nSesion: $([string]$s.session_id)"
    $mission.Text="Objetivo: $([string]$s.active_goal)`r`nMision: $([string]$s.active_mission_id)"
    $r=$s.last_result
    $runtimeStatus='-';$candidateCount='-';$generatedCount='-';$learningScanned='-';$learningCreated='-';$completed=$null;$total=$null
    if($null -ne $r){$runtime=$r.runtime;if($null -ne $runtime -and -not [string]::IsNullOrWhiteSpace([string]$runtime.status)){$runtimeStatus=[string]$runtime.status}else{$runtimeStatus=[string]$r.status};if($null -ne $r.candidate_count){$candidateCount=[string]$r.candidate_count};if($null -ne $r.generated_count){$generatedCount=[string]$r.generated_count};if($null -ne $r.learning){if($null -ne $r.learning.scanned){$learningScanned=[string]$r.learning.scanned};if($null -ne $r.learning.created){$learningCreated=[string]$r.learning.created}};if($null -ne $runtime){if($null -ne $runtime.completed_steps){$completed=[int]$runtime.completed_steps};if($null -ne $runtime.total_steps){$total=[int]$runtime.total_steps}}}
    if($null -ne $completed -and $null -ne $total){$progress.Text="PROGRESO: $completed / $total pasos | RUNTIME: $runtimeStatus"}else{$progress.Text="PROGRESO: sin pasos | RUNTIME: $runtimeStatus"}
    $lastStatus='-';if($null -ne $r -and $null -ne $r.status){$lastStatus=[string]$r.status}
    $telemetry.Text="Fabrica: $candidateCount candidatos | $generatedCount objetivos nuevos`r`nAprendizaje: $learningScanned escaneados | $learningCreated creados`r`nTicks: $($s.tick_count) | Ultimo: $lastStatus"
    $nextAction='sin accion reportada';if($null -ne $runtime -and $runtime.next_action){$nextAction=[string]$runtime.next_action}elseif($null -ne $r -and $r.next_action){$nextAction=[string]$r.next_action};$next.Text="Proxima accion: $nextAction"
}
function Refresh-Ui {
    try {
        $s=Get-Status
        Apply-Status $s
        $a=Get-ActivityLog
        if($null -ne $a -and $a.content){$lines=([string]$a.content)-split "`r?`n"|Where-Object{$_}|Select-Object -Last 22;$log.Text=$lines -join [Environment]::NewLine}
    } catch { Set-CommandResult("UI ERROR: $($_.Exception.Message)",$true) }
}
$timer=New-Object System.Windows.Forms.Timer;$timer.Interval=2000;$timer.Add_Tick({try{Refresh-Ui}catch{}});$timer.Start();Refresh-Ui;[void]$form.ShowDialog()
