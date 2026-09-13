param([int]$Port = 45873)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$base = "http://127.0.0.1:$Port"
$heartbeatSeconds = 30

function Get-Status {
    try { return Invoke-RestMethod -Method Get -Uri "$base/status" -TimeoutSec 3 }
    catch { return $null }
}

function Get-ActivityLog {
    try { return Invoke-RestMethod -Method Get -Uri "$base/log" -TimeoutSec 3 }
    catch { return $null }
}

function Invoke-Aria([string]$path) {
    try {
        $result = Invoke-RestMethod -Method Post -Uri "$base$path" -TimeoutSec 8
        Refresh-Ui
        return $result
    } catch {
        [System.Windows.Forms.MessageBox]::Show("ARIA Agent no responde.`r`n`r`nRuta: $path`r`nError: $($_.Exception.Message)", 'ARIA - Meditacion IA', 'OK', 'Warning') | Out-Null
        Refresh-Ui
        return $null
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ARIA - Meditacion IA'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(900, 720)
$form.MinimumSize = New-Object System.Drawing.Size(900, 720)
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'ARIA - MEDITACION IA'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(28, 18)
$form.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Control local del Autonomous Continuity Engine'
$subtitle.AutoSize = $true
$subtitle.ForeColor = [System.Drawing.Color]::DimGray
$subtitle.Location = New-Object System.Drawing.Point(31, 56)
$form.Controls.Add($subtitle)

$status = New-Object System.Windows.Forms.Label
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(820, 32)
$status.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$status.Location = New-Object System.Drawing.Point(30, 82)
$form.Controls.Add($status)

$mode = New-Object System.Windows.Forms.Label
$mode.AutoSize = $false
$mode.Size = New-Object System.Drawing.Size(400, 55)
$mode.Location = New-Object System.Drawing.Point(30, 120)
$form.Controls.Add($mode)

$mission = New-Object System.Windows.Forms.Label
$mission.AutoSize = $false
$mission.Size = New-Object System.Drawing.Size(400, 55)
$mission.Location = New-Object System.Drawing.Point(445, 120)
$form.Controls.Add($mission)

$progress = New-Object System.Windows.Forms.Label
$progress.AutoSize = $false
$progress.Size = New-Object System.Drawing.Size(820, 48)
$progress.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$progress.Location = New-Object System.Drawing.Point(30, 180)
$form.Controls.Add($progress)

$telemetry = New-Object System.Windows.Forms.Label
$telemetry.AutoSize = $false
$telemetry.Size = New-Object System.Drawing.Size(820, 72)
$telemetry.Location = New-Object System.Drawing.Point(30, 228)
$form.Controls.Add($telemetry)

$next = New-Object System.Windows.Forms.Label
$next.AutoSize = $false
$next.Size = New-Object System.Drawing.Size(820, 42)
$next.Location = New-Object System.Drawing.Point(30, 302)
$form.Controls.Add($next)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.Font = New-Object System.Drawing.Font('Consolas', 9)
$log.Location = New-Object System.Drawing.Point(30, 350)
$log.Size = New-Object System.Drawing.Size(820, 225)
$form.Controls.Add($log)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'ACTIVAR inicia continuidad. PAUSAR conserva la sesion. DETENER guarda checkpoint y libera la continuidad.'
$hint.AutoSize = $true
$hint.ForeColor = [System.Drawing.Color]::DimGray
$hint.Location = New-Object System.Drawing.Point(30, 585)
$form.Controls.Add($hint)

$buttons = @(
    @{t='ACTIVAR'; x=30;  p='/start'},
    @{t='PAUSAR'; x=225;  p='/pause'},
    @{t='CONTINUAR'; x=420; p='/resume'},
    @{t='DETENER'; x=615; p='/stop'}
)
foreach ($item in $buttons) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $item.t
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $button.Size = New-Object System.Drawing.Size(175, 48)
    $button.Location = New-Object System.Drawing.Point($item.x, 620)
    $button.Tag = $item.p
    $button.Add_Click({ [void](Invoke-Aria ([string]$this.Tag)) })
    $form.Controls.Add($button)
}

function Refresh-Ui {
    $s = Get-Status
    if ($null -eq $s) {
        $status.Text = '[OFFLINE] ARIA Local Agent no responde'
        $status.ForeColor = [System.Drawing.Color]::Firebrick
        $mode.Text = 'Modo: -`r`nSesion: -'
        $mission.Text = 'Objetivo: -`r`nMision: -'
        $progress.Text = 'Progreso: -'
        $telemetry.Text = 'Telemetria: sin datos'
        $next.Text = 'Proxima accion: -'
        return
    }

    $status.Text = "[ONLINE] Modo: $($s.mode.ToUpperInvariant())"
    if ($s.mode -eq 'active') {
        $status.ForeColor = [System.Drawing.Color]::ForestGreen
    } elseif ($s.mode -eq 'paused') {
        $status.ForeColor = [System.Drawing.Color]::DarkOrange
    } else {
        $status.ForeColor = [System.Drawing.Color]::DimGray
    }

    $mode.Text = "Modo: $($s.mode)`r`nSesion: $([string]$s.session_id)"
    $mission.Text = "Objetivo: $([string]$s.active_goal)`r`nMision: $([string]$s.active_mission_id)"

    $r = $s.last_result
    $runtime = $null
    $completed = $null
    $total = $null
    $runtimeStatus = '-'
    $candidateCount = '-'
    $generatedCount = '-'
    $learningScanned = '-'
    $learningCreated = '-'

    if ($null -ne $r) {
        $runtime = $r.runtime
        $runtimeStatus = if ($runtime -and $runtime.status) { [string]$runtime.status } else { [string]$r.status }
        if ($null -ne $r.candidate_count) { $candidateCount = [string]$r.candidate_count }
        if ($null -ne $r.generated_count) { $generatedCount = [string]$r.generated_count }
        if ($r.learning) {
            if ($null -ne $r.learning.scanned) { $learningScanned = [string]$r.learning.scanned }
            if ($null -ne $r.learning.created) { $learningCreated = [string]$r.learning.created }
        }
        if ($runtime) {
            if ($null -ne $runtime.completed_steps) { $completed = [int]$runtime.completed_steps }
            if ($null -ne $runtime.total_steps) { $total = [int]$runtime.total_steps }
        }
    }

    if ($null -ne $completed -and $null -ne $total) {
        $progress.Text = "PROGRESO DE MISION: $completed / $total pasos completados    |    RUNTIME: $runtimeStatus"
    } else {
        $progress.Text = "PROGRESO DE MISION: sin pasos reportados    |    RUNTIME: $runtimeStatus"
    }

    $telemetry.Text = "Fabrica: $candidateCount candidatos detectados | $generatedCount objetivos nuevos generados`r`nAprendizaje: $learningScanned resultados escaneados | $learningCreated aprendizajes creados`r`nTicks: $($s.tick_count) | Ultimo resultado: $([string]$r.status)"

    $nextAction = if ($runtime -and $runtime.next_action) { [string]$runtime.next_action } elseif ($r -and $r.next_action) { [string]$r.next_action } else { 'sin accion reportada' }
    $next.Text = "Proxima accion: $nextAction"

    if ($s.last_tick_at) {
        try {
            $elapsed = [int](([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($s.last_tick_at)).TotalSeconds)
            $remaining = [Math]::Max(0, $heartbeatSeconds - $elapsed)
            $next.Text += "   |   Ultimo tick: ${elapsed}s   |   Proxima revision: ${remaining}s"
        } catch {}
    }

    $a = Get-ActivityLog
    if ($a -and $a.content) {
        $lines = ([string]$a.content) -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 22
        $log.Text = $lines -join [Environment]::NewLine
        $log.SelectionStart = $log.TextLength
        $log.ScrollToCaret()
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 2000
$timer.Add_Tick({ Refresh-Ui })
$timer.Start()
Refresh-Ui
[void]$form.ShowDialog()
