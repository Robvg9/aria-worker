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

# === MEDITATION CENTER v1 UI LAYER ===
$form.Size=New-Object System.Drawing.Size(1220,820)
$form.MinimumSize=New-Object System.Drawing.Size(1100,760)
foreach($control in @($status,$mode,$mission,$progress,$telemetry,$next,$commandResult,$log)){
    if($null -ne $control){$control.Visible=$false}
}
foreach($control in @($form.Controls)){if($control -is [System.Windows.Forms.Button]){$control.Visible=$false}}

function Center-Api([string]$method,[string]$path,$body=$null){
    try{
        if($null -eq $body){return Invoke-RestMethod -Method $method -Uri "$base$path" -TimeoutSec 15 -ErrorAction Stop}
        return Invoke-RestMethod -Method $method -Uri "$base$path" -ContentType 'application/json' -Body ($body|ConvertTo-Json -Depth 8 -Compress) -TimeoutSec 15 -ErrorAction Stop
    }catch{return $null}
}
function Center-RefreshCatalog{
    $cat=Center-Api 'GET' '/catalog'
    $catalogGrid.Rows.Clear()
    if($null -eq $cat -or $null -eq $cat.items){$catalogCount.Text='Misiones visibles: sin conexión';return}
    $needle=$catalogSearch.Text.Trim().ToLowerInvariant()
    foreach($item in $cat.items){
        $hay=("$($item.title) $($item.summary) $($item.status) $($item.source_type)").ToLowerInvariant()
        if($needle -and -not $hay.Contains($needle)){continue}
        $i=$catalogGrid.Rows.Add([string]$item.title,[string]$item.status,[string]$item.progress_percent+"%",[string]$item.human_gate.label,[string]$item.priority,[string]$item.source_type)
        $catalogGrid.Rows[$i].Tag=$item.id
    }
    $catalogCount.Text="Misiones visibles: $($catalogGrid.Rows.Count)"
}
function Center-SelectedCatalog{
    $cat=Center-Api 'GET' '/catalog'
    if($catalogGrid.SelectedRows.Count -lt 1 -or $null -eq $cat){return $null}
    $id=[string]$catalogGrid.SelectedRows[0].Tag
    return $cat.items|Where-Object{[string]$_.id -eq $id}|Select-Object -First 1
}
function Center-ShowCatalogDetail{
    $item=Center-SelectedCatalog
    if($null -eq $item){return}
    $nl=[Environment]::NewLine
    $catalogDetail.Text='TÍTULO:'+$nl+[string]$item.title+$nl+$nl+
        'RESULTADO:'+$nl+[string]$item.result+$nl+$nl+
        'SOLUCIÓN:'+$nl+[string]$item.solution+$nl+$nl+
        'MEJORA ARIA:'+$nl+[string]$item.improvement+$nl+$nl+
        'ESTADO: '+[string]$item.status+' | PROGRESO: '+[string]$item.progress_percent+'%'+$nl+
        'HUMAN GATE: '+[string]$item.human_gate.label+$nl+
        'RIESGO: '+[string]$item.risk+' | ORIGEN: '+[string]$item.source_type+$nl+$nl+
        'DESCRIPCIÓN TÉCNICA:'+$nl+[string]$item.technical_description+$nl+$nl+
        'DEPENDENCIAS:'+$nl+[string]($item.dependencies -join ', ')
}
function Center-AddQueue{
    $item=Center-SelectedCatalog
    if($null -eq $item){return}
    $id=if([string]$item.item_type -eq 'goal'){[string]$item.goal_id}else{[string]$item.mission_id}
    $r=Center-Api 'POST' '/queue/add' @{item_type=[string]$item.item_type;item_id=$id}
    if($null -eq $r -or $r.ok -eq $false){$centerMessage.Text='ERROR: '+[string]$r.error;$centerMessage.ForeColor=[System.Drawing.Color]::Firebrick}
    else{$centerMessage.Text='COLA: misión agregada correctamente';$centerMessage.ForeColor=[System.Drawing.Color]::DarkGreen;Center-RefreshQueue}
}
function Center-RefreshQueue{
    $q=Center-Api 'GET' '/queue'
    $queueGrid.Rows.Clear()
    if($null -eq $q -or $null -eq $q.items){$queueCount.Text='Cola manual: sin conexión';return}
    foreach($item in @($q.items|Where-Object{[string]$_.status -in @('queued','running','paused','failed','blocked')})){
        $i=$queueGrid.Rows.Add([string]$item.position,[string]$item.item_type,[string]$item.item_id,[string]$item.status,[string]$item.resolved_mission_id)
        $queueGrid.Rows[$i].Tag=$item.queue_id
    }
    $queueCount.Text='Cola manual: '+[string]$queueGrid.Rows.Count
}
function Center-RunNext{
    $r=Center-Api 'POST' '/queue/run-next' @{}
    if($null -eq $r){$centerMessage.Text='ERROR: sin respuesta del gateway';$centerMessage.ForeColor=[System.Drawing.Color]::Firebrick}
    elseif($r.ok -eq $false){$centerMessage.Text='ERROR: '+[string]$r.error;$centerMessage.ForeColor=[System.Drawing.Color]::Firebrick}
    else{$centerMessage.Text='COLA: '+[string]$r.status+' | MISIÓN: '+[string]$r.mission_id;$centerMessage.ForeColor=[System.Drawing.Color]::DarkGreen;Center-RefreshQueue}
}
function Center-Reorder([int]$delta){
    if($queueGrid.SelectedRows.Count -lt 1){return}
    $rows=@($queueGrid.Rows);$idx=$queueGrid.SelectedRows[0].Index;$target=$idx+$delta
    if($target -lt 0 -or $target -ge $rows.Count){return}
    $ids=@($rows|ForEach-Object{[string]$_.Tag});$tmp=$ids[$idx];$ids[$idx]=$ids[$target];$ids[$target]=$tmp
    $r=Center-Api 'POST' '/queue/reorder' @{queue_ids=$ids}
    if($null -eq $r -or $r.ok -eq $false){$centerMessage.Text='ERROR: no se pudo reordenar';$centerMessage.ForeColor=[System.Drawing.Color]::Firebrick}else{Center-RefreshQueue}
}
function Center-Remove{
    if($queueGrid.SelectedRows.Count -lt 1){return}
    $r=Center-Api 'POST' '/queue/remove' @{queue_id=[string]$queueGrid.SelectedRows[0].Tag}
    if($null -eq $r -or $r.ok -eq $false){$centerMessage.Text='ERROR: no se pudo quitar';$centerMessage.ForeColor=[System.Drawing.Color]::Firebrick}else{Center-RefreshQueue}
}
function Center-RefreshActive{
    $s=Status();$cat=Center-Api 'GET' '/catalog'
    if($null -eq $s){$centerStatus.Text='[OFFLINE] ARIA Local Agent';$centerStatus.ForeColor=[System.Drawing.Color]::Firebrick;return}
    $centerStatus.Text='[ONLINE] MODO: '+([string]$s.mode).ToUpperInvariant();$centerStatus.ForeColor=[System.Drawing.Color]::DarkGreen
    $id=[string]$s.active_mission_id;$item=$null
    if($null -ne $cat -and $null -ne $cat.items){$item=$cat.items|Where-Object{[string]$_.mission_id -eq $id}|Select-Object -First 1}
    $nl=[Environment]::NewLine
    if($null -eq $item){
        $activeTitle.Text='MISIÓN ACTIVA: '+$id
        $activeProgress.Text='PROGRESO: sin datos'
        $activeGate.Text='HUMAN GATE: NO EXISTE MISION HUMANA'
        $activeDetail.Text=''
        $stepsGrid.Rows.Clear()
        return
    }
    $activeTitle.Text='MISIÓN ACTIVA: '+[string]$item.title
    $activeProgress.Text='PROGRESO: '+[string]$item.progress_percent+'%  |  PASOS: '+[string]$item.progress_steps.completed+'/'+[string]$item.progress_steps.total
    $activeGate.Text='HUMAN GATE: '+[string]$item.human_gate.label
    $activeDetail.Text='RESULTADO:'+$nl+[string]$item.result+$nl+$nl+'SOLUCIÓN:'+$nl+[string]$item.solution+$nl+$nl+'MEJORA ARIA:'+$nl+[string]$item.improvement
    $stepsGrid.Rows.Clear()
    if($null -ne $item.steps){foreach($st in $item.steps){[void]$stepsGrid.Rows.Add([string]$st.index,[string]$st.title,[string]$st.status,[string]$st.risk,[string]$st.executor_type)}}
}
$tabs=New-Object System.Windows.Forms.TabControl;$tabs.Location=New-Object System.Drawing.Point(20,95);$tabs.Size=New-Object System.Drawing.Size(1165,680);$form.Controls.Add($tabs)
$tabCenter=New-Object System.Windows.Forms.TabPage;$tabCenter.Text='CENTRO';$tabs.TabPages.Add($tabCenter)
$tabCatalog=New-Object System.Windows.Forms.TabPage;$tabCatalog.Text='CATÁLOGO';$tabs.TabPages.Add($tabCatalog)
$tabQueue=New-Object System.Windows.Forms.TabPage;$tabQueue.Text='COLA MANUAL';$tabs.TabPages.Add($tabQueue)

$centerStatus=New-Object System.Windows.Forms.Label;$centerStatus.AutoSize=$true;$centerStatus.Font=New-Object System.Drawing.Font('Segoe UI',13,[System.Drawing.FontStyle]::Bold);$centerStatus.Location=New-Object System.Drawing.Point(18,15);$tabCenter.Controls.Add($centerStatus)
$activeTitle=New-Object System.Windows.Forms.Label;$activeTitle.AutoSize=$false;$activeTitle.Size=New-Object System.Drawing.Size(1090,45);$activeTitle.Font=New-Object System.Drawing.Font('Segoe UI',12,[System.Drawing.FontStyle]::Bold);$activeTitle.Location=New-Object System.Drawing.Point(18,50);$tabCenter.Controls.Add($activeTitle)
$activeProgress=New-Object System.Windows.Forms.Label;$activeProgress.AutoSize=$true;$activeProgress.Font=New-Object System.Drawing.Font('Segoe UI',11,[System.Drawing.FontStyle]::Bold);$activeProgress.Location=New-Object System.Drawing.Point(18,98);$tabCenter.Controls.Add($activeProgress)
$activeGate=New-Object System.Windows.Forms.Label;$activeGate.AutoSize=$false;$activeGate.Size=New-Object System.Drawing.Size(1090,35);$activeGate.Font=New-Object System.Drawing.Font('Segoe UI',11,[System.Drawing.FontStyle]::Bold);$activeGate.Location=New-Object System.Drawing.Point(18,130);$tabCenter.Controls.Add($activeGate)
$activeDetail=New-Object System.Windows.Forms.RichTextBox;$activeDetail.ReadOnly=$true;$activeDetail.Location=New-Object System.Drawing.Point(18,172);$activeDetail.Size=New-Object System.Drawing.Size(720,165);$tabCenter.Controls.Add($activeDetail)
$stepsGrid=New-Object System.Windows.Forms.DataGridView;$stepsGrid.Location=New-Object System.Drawing.Point(18,350);$stepsGrid.Size=New-Object System.Drawing.Size(1090,220);$stepsGrid.ReadOnly=$true;$stepsGrid.AllowUserToAddRows=$false;$stepsGrid.RowHeadersVisible=$false;$stepsGrid.AutoSizeColumnsMode='Fill';[void]$stepsGrid.Columns.Add('n','Paso');[void]$stepsGrid.Columns.Add('title','Descripción');[void]$stepsGrid.Columns.Add('status','Estado');[void]$stepsGrid.Columns.Add('risk','Riesgo');[void]$stepsGrid.Columns.Add('exec','Executor');$tabCenter.Controls.Add($stepsGrid)

$catalogSearch=New-Object System.Windows.Forms.TextBox;$catalogSearch.Location=New-Object System.Drawing.Point(15,15);$catalogSearch.Size=New-Object System.Drawing.Size(380,28);$tabCatalog.Controls.Add($catalogSearch)
$catalogSearch.Add_TextChanged({Center-RefreshCatalog})
$catalogCount=New-Object System.Windows.Forms.Label;$catalogCount.AutoSize=$true;$catalogCount.Location=New-Object System.Drawing.Point(410,20);$tabCatalog.Controls.Add($catalogCount)
$catalogGrid=New-Object System.Windows.Forms.DataGridView;$catalogGrid.Location=New-Object System.Drawing.Point(15,55);$catalogGrid.Size=New-Object System.Drawing.Size(1115,300);$catalogGrid.ReadOnly=$true;$catalogGrid.AllowUserToAddRows=$false;$catalogGrid.SelectionMode='FullRowSelect';$catalogGrid.MultiSelect=$false;$catalogGrid.RowHeadersVisible=$false;$catalogGrid.AutoSizeColumnsMode='Fill';[void]$catalogGrid.Columns.Add('title','Misión');[void]$catalogGrid.Columns.Add('status','Estado');[void]$catalogGrid.Columns.Add('progress','Progreso');[void]$catalogGrid.Columns.Add('gate','Human Gate');[void]$catalogGrid.Columns.Add('priority','Prioridad');[void]$catalogGrid.Columns.Add('source','Origen');$tabCatalog.Controls.Add($catalogGrid)
$catalogGrid.Add_SelectionChanged({Center-ShowCatalogDetail})
$catalogDetail=New-Object System.Windows.Forms.RichTextBox;$catalogDetail.ReadOnly=$true;$catalogDetail.Location=New-Object System.Drawing.Point(15,370);$catalogDetail.Size=New-Object System.Drawing.Size(800,220);$tabCatalog.Controls.Add($catalogDetail)
$addQueue=New-Object System.Windows.Forms.Button;$addQueue.Text='AGREGAR A COLA';$addQueue.Font=New-Object System.Drawing.Font('Segoe UI',10,[System.Drawing.FontStyle]::Bold);$addQueue.Size=New-Object System.Drawing.Size(240,50);$addQueue.Location=New-Object System.Drawing.Point(850,385);$addQueue.Add_Click({Center-AddQueue});$tabCatalog.Controls.Add($addQueue)
$refreshCatalog=New-Object System.Windows.Forms.Button;$refreshCatalog.Text='ACTUALIZAR';$refreshCatalog.Size=New-Object System.Drawing.Size(240,42);$refreshCatalog.Location=New-Object System.Drawing.Point(850,450);$refreshCatalog.Add_Click({Center-RefreshCatalog});$tabCatalog.Controls.Add($refreshCatalog)

$queueCount=New-Object System.Windows.Forms.Label;$queueCount.AutoSize=$true;$queueCount.Location=New-Object System.Drawing.Point(15,15);$tabQueue.Controls.Add($queueCount)
$queueGrid=New-Object System.Windows.Forms.DataGridView;$queueGrid.Location=New-Object System.Drawing.Point(15,48);$queueGrid.Size=New-Object System.Drawing.Size(1115,375);$queueGrid.ReadOnly=$true;$queueGrid.AllowUserToAddRows=$false;$queueGrid.SelectionMode='FullRowSelect';$queueGrid.MultiSelect=$false;$queueGrid.RowHeadersVisible=$false;$queueGrid.AutoSizeColumnsMode='Fill';[void]$queueGrid.Columns.Add('pos','Posición');[void]$queueGrid.Columns.Add('type','Tipo');[void]$queueGrid.Columns.Add('id','Referencia');[void]$queueGrid.Columns.Add('status','Estado');[void]$queueGrid.Columns.Add('mission','Misión resuelta');$tabQueue.Controls.Add($queueGrid)
$queueUp=New-Object System.Windows.Forms.Button;$queueUp.Text='SUBIR';$queueUp.Size=New-Object System.Drawing.Size(120,44);$queueUp.Location=New-Object System.Drawing.Point(15,445);$queueUp.Add_Click({Center-Reorder -1});$tabQueue.Controls.Add($queueUp)
$queueDown=New-Object System.Windows.Forms.Button;$queueDown.Text='BAJAR';$queueDown.Size=New-Object System.Drawing.Size(120,44);$queueDown.Location=New-Object System.Drawing.Point(150,445);$queueDown.Add_Click({Center-Reorder 1});$tabQueue.Controls.Add($queueDown)
$queueRemove=New-Object System.Windows.Forms.Button;$queueRemove.Text='QUITAR';$queueRemove.Size=New-Object System.Drawing.Size(120,44);$queueRemove.Location=New-Object System.Drawing.Point(285,445);$queueRemove.Add_Click({Center-Remove});$tabQueue.Controls.Add($queueRemove)
$queueRun=New-Object System.Windows.Forms.Button;$queueRun.Text='EJECUTAR SIGUIENTE';$queueRun.Font=New-Object System.Drawing.Font('Segoe UI',10,[System.Drawing.FontStyle]::Bold);$queueRun.Size=New-Object System.Drawing.Size(220,44);$queueRun.Location=New-Object System.Drawing.Point(430,445);$queueRun.Add_Click({Center-RunNext});$tabQueue.Controls.Add($queueRun)
$queueRefresh=New-Object System.Windows.Forms.Button;$queueRefresh.Text='ACTUALIZAR COLA';$queueRefresh.Size=New-Object System.Drawing.Size(180,44);$queueRefresh.Location=New-Object System.Drawing.Point(665,445);$queueRefresh.Add_Click({Center-RefreshQueue});$tabQueue.Controls.Add($queueRefresh)
$centerMessage=New-Object System.Windows.Forms.Label;$centerMessage.AutoSize=$false;$centerMessage.Size=New-Object System.Drawing.Size(760,30);$centerMessage.Location=New-Object System.Drawing.Point(18,600);$centerMessage.Font=New-Object System.Drawing.Font('Consolas',9,[System.Drawing.FontStyle]::Bold);$tabCenter.Controls.Add($centerMessage)

$timer=New-Object System.Windows.Forms.Timer;$timer.Interval=3000;$timer.Add_Tick({try{Center-RefreshActive;Center-RefreshCatalog;Center-RefreshQueue}catch{}});$timer.Start()
Center-RefreshActive
Center-RefreshCatalog
Center-RefreshQueue
[void]$form.ShowDialog()

