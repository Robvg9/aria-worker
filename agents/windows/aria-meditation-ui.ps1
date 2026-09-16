param([int]$Port = 45873)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$base = "http://127.0.0.1:$Port"
$heartbeatSeconds = 30
$script:busy = $false

function C([string]$name) { return [System.Drawing.Color]::FromName($name) }
function Get-Status {
    try { return Invoke-RestMethod -Method Get -Uri "$base/status" -TimeoutSec 3 }
    catch { return $null }
}
function Get-ActivityLog {
    try { return Invoke-RestMethod -Method Get -Uri "$base/log" -TimeoutSec 3 }
    catch { return $null }
}

function Set-UiFeedback([string]$text, [string]$kind = 'info') {
    $feedback.Text = $text
    switch ($kind) {
        'ok' { $feedback.ForeColor = C 'LightGreen' }
        'warn' { $feedback.ForeColor = C 'Khaki' }
        'error' { $feedback.ForeColor = C 'Salmon' }
        default { $feedback.ForeColor = C 'LightSteelBlue' }
    }
}

function Invoke-Aria([string]$path, [string]$label) {
    if ($script:busy) { return }
    $script:busy = $true
    Set-UiFeedback "$label..." 'info'
    try {
        $result = Invoke-RestMethod -Method Post -Uri "$base$path" -TimeoutSec 10
        Start-Sleep -Milliseconds 120
        Refresh-Ui
        Start-Sleep -Milliseconds 120
        Refresh-Ui
        $s = Get-Status
        if ($s) {
            if ($s.mode -eq 'active') { Set-UiFeedback 'Meditacion IA ACTIVA y ejecutando continuidad.' 'ok' }
            elseif ($s.mode -eq 'paused') { Set-UiFeedback 'Meditacion IA en PAUSA. La sesion queda conservada.' 'warn' }
            elseif ($s.mode -eq 'stopped') { Set-UiFeedback 'Meditacion IA DETENIDA. El checkpoint queda guardado.' 'warn' }
            else { Set-UiFeedback "Estado recibido: $($s.mode)" 'info' }
        } else {
            Set-UiFeedback 'El controlador local no responde.' 'error'
        }
        return $result
    } catch {
        Set-UiFeedback "No se pudo ejecutar $label: $($_.Exception.Message)" 'error'
        return $null
    } finally {
        $script:busy = $false
        Refresh-Ui
    }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ARIA — Meditación IA'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1080, 790)
$form.MinimumSize = New-Object System.Drawing.Size(980, 720)
$form.MaximizeBox = $true
$form.BackColor = C 'MidnightBlue'
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$header = New-Object System.Windows.Forms.Panel
$header.Location = New-Object System.Drawing.Point(22, 18)
$header.Size = New-Object System.Drawing.Size(1020, 92)
$header.BackColor = C 'DarkSlateBlue'
$form.Controls.Add($header)

$logo = New-Object System.Windows.Forms.Label
$logo.Text = 'A'
$logo.TextAlign = 'MiddleCenter'
$logo.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$logo.ForeColor = C 'White'
$logo.BackColor = C 'MediumPurple'
$logo.Size = New-Object System.Drawing.Size(54, 54)
$logo.Location = New-Object System.Drawing.Point(20, 19)
$header.Controls.Add($logo)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'ARIA — MEDITACIÓN IA'
$title.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 20, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = C 'White'
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(92, 17)
$header.Controls.Add($title)

$subtitle = New-Object System.Windows.Forms.Label
$subtitle.Text = 'Autonomous Continuity Engine · Control local'
$subtitle.ForeColor = C 'LightSteelBlue'
$subtitle.AutoSize = $true
$subtitle.Location = New-Object System.Drawing.Point(95, 54)
$header.Controls.Add($subtitle)

$connection = New-Object System.Windows.Forms.Label
$connection.Text = '● LOCAL'
$connection.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10, [System.Drawing.FontStyle]::Bold)
$connection.ForeColor = C 'LightGreen'
$connection.AutoSize = $true
$connection.Location = New-Object System.Drawing.Point(910, 36)
$header.Controls.Add($connection)

$statusCard = New-Object System.Windows.Forms.Panel
$statusCard.Location = New-Object System.Drawing.Point(22, 126)
$statusCard.Size = New-Object System.Drawing.Size(1020, 112)
$statusCard.BackColor = C 'SlateGray'
$form.Controls.Add($statusCard)

$statusDot = New-Object System.Windows.Forms.Label
$statusDot.Text = '●'
$statusDot.Font = New-Object System.Drawing.Font('Segoe UI', 22, [System.Drawing.FontStyle]::Bold)
$statusDot.ForeColor = C 'DarkGray'
$statusDot.AutoSize = $true
$statusDot.Location = New-Object System.Drawing.Point(22, 31)
$statusCard.Controls.Add($statusDot)

$status = New-Object System.Windows.Forms.Label
$status.Text = 'CONECTANDO...'
$status.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 22, [System.Drawing.FontStyle]::Bold)
$status.ForeColor = C 'White'
$status.AutoSize = $true
$status.Location = New-Object System.Drawing.Point(62, 24)
$statusCard.Controls.Add($status)

$session = New-Object System.Windows.Forms.Label
$session.Text = 'Sesion: —'
$session.ForeColor = C 'Gainsboro'
$session.AutoSize = $true
$session.Location = New-Object System.Drawing.Point(66, 67)
$statusCard.Controls.Add($session)

$feedback = New-Object System.Windows.Forms.Label
$feedback.Text = 'Esperando estado...'
$feedback.ForeColor = C 'LightSteelBlue'
$feedback.AutoSize = $false
$feedback.TextAlign = 'MiddleRight'
$feedback.Size = New-Object System.Drawing.Size(520, 30)
$feedback.Location = New-Object System.Drawing.Point(465, 39)
$statusCard.Controls.Add($feedback)

$cards = @(
    @{x=22;  t='TICKS'; v='0'; n='ticks ejecutados'},
    @{x=277; t='MISIÓN'; v='—'; n='misión actual'},
    @{x=532; t='RUNTIME'; v='—'; n='último resultado'},
    @{x=787; t='NUEVOS'; v='0'; n='objetivos generados'}
)
$metricPanels = @()
foreach ($item in $cards) {
    $p = New-Object System.Windows.Forms.Panel
    $p.Location = New-Object System.Drawing.Point($item.x, 258)
    $p.Size = New-Object System.Drawing.Size(235, 104)
    $p.BackColor = C 'SlateGray'
    $form.Controls.Add($p)

    $t = New-Object System.Windows.Forms.Label
    $t.Text = $item.t
    $t.ForeColor = C 'LightSteelBlue'
    $t.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9, [System.Drawing.FontStyle]::Bold)
    $t.AutoSize = $true
    $t.Location = New-Object System.Drawing.Point(16, 12)
    $p.Controls.Add($t)

    $v = New-Object System.Windows.Forms.Label
    $v.Text = $item.v
    $v.ForeColor = C 'White'
    $v.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 16, [System.Drawing.FontStyle]::Bold)
    $v.AutoSize = $false
    $v.Size = New-Object System.Drawing.Size(205, 34)
    $v.Location = New-Object System.Drawing.Point(16, 34)
    $p.Controls.Add($v)

    $n = New-Object System.Windows.Forms.Label
    $n.Text = $item.n
    $n.ForeColor = C 'Gainsboro'
    $n.AutoSize = $true
    $n.Location = New-Object System.Drawing.Point(16, 75)
    $p.Controls.Add($n)
    $metricPanels += $v
}

$detail = New-Object System.Windows.Forms.Panel
$detail.Location = New-Object System.Drawing.Point(22, 382)
$detail.Size = New-Object System.Drawing.Size(430, 170)
$detail.BackColor = C 'SlateGray'
$form.Controls.Add($detail)

$detailTitle = New-Object System.Windows.Forms.Label
$detailTitle.Text = 'ESTADO DEL CICLO'
$detailTitle.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10, [System.Drawing.FontStyle]::Bold)
$detailTitle.ForeColor = C 'LightSteelBlue'
$detailTitle.AutoSize = $true
$detailTitle.Location = New-Object System.Drawing.Point(18, 15)
$detail.Controls.Add($detailTitle)

$mode = New-Object System.Windows.Forms.Label
$mode.Text = 'Modo: —'
$mode.ForeColor = C 'White'
$mode.AutoSize = $true
$mode.Location = New-Object System.Drawing.Point(18, 48)
$detail.Controls.Add($mode)

$goal = New-Object System.Windows.Forms.Label
$goal.Text = 'Objetivo: —'
$goal.ForeColor = C 'Gainsboro'
$goal.AutoSize = $false
$goal.Size = New-Object System.Drawing.Size(390, 36)
$goal.Location = New-Object System.Drawing.Point(18, 78)
$detail.Controls.Add($goal)

$next = New-Object System.Windows.Forms.Label
$next.Text = 'Próxima acción: —'
$next.ForeColor = C 'LightSteelBlue'
$next.AutoSize = $false
$next.Size = New-Object System.Drawing.Size(390, 40)
$next.Location = New-Object System.Drawing.Point(18, 117)
$detail.Controls.Add($next)

$logPanel = New-Object System.Windows.Forms.Panel
$logPanel.Location = New-Object System.Drawing.Point(472, 382)
$logPanel.Size = New-Object System.Drawing.Size(570, 300)
$logPanel.BackColor = C 'SlateGray'
$form.Controls.Add($logPanel)

$logTitle = New-Object System.Windows.Forms.Label
$logTitle.Text = 'ACTIVIDAD RECIENTE'
$logTitle.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 10, [System.Drawing.FontStyle]::Bold)
$logTitle.ForeColor = C 'LightSteelBlue'
$logTitle.AutoSize = $true
$logTitle.Location = New-Object System.Drawing.Point(18, 15)
$logPanel.Controls.Add($logTitle)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.WordWrap = $false
$log.Font = New-Object System.Drawing.Font('Cascadia Mono', 9)
$log.BackColor = C 'MidnightBlue'
$log.ForeColor = C 'Gainsboro'
$log.BorderStyle = 'None'
$log.Location = New-Object System.Drawing.Point(18, 42)
$log.Size = New-Object System.Drawing.Size(534, 235)
$logPanel.Controls.Add($log)

$buttonPanel = New-Object System.Windows.Forms.Panel
$buttonPanel.Location = New-Object System.Drawing.Point(22, 570)
$buttonPanel.Size = New-Object System.Drawing.Size(430, 112)
$buttonPanel.BackColor = C 'SlateGray'
$form.Controls.Add($buttonPanel)

$buttonDefs = @(
    @{t='ACTIVAR'; p='/start'; x=18; y=18; w=185; mode='active'},
    @{t='PAUSAR'; p='/pause'; x=215; y=18; w=95; mode='paused'},
    @{t='CONTINUAR'; p='/resume'; x=18; y=64; w=185; mode='resume'},
    @{t='DETENER'; p='/stop'; x=215; y=64; w=95; mode='stopped'}
)
foreach ($item in $buttonDefs) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $item.t
    $button.Font = New-Object System.Drawing.Font('Segoe UI Semibold', 9, [System.Drawing.FontStyle]::Bold)
    $button.Size = New-Object System.Drawing.Size($item.w, 34)
    $button.Location = New-Object System.Drawing.Point($item.x, $item.y)
    $button.FlatStyle = 'Flat'
    $button.FlatAppearance.BorderSize = 0
    $button.BackColor = if ($item.mode -eq 'active') { C 'MediumPurple' } elseif ($item.mode -eq 'stopped') { C 'IndianRed' } else { C 'DarkSlateBlue' }
    $button.ForeColor = C 'White'
    $button.Tag = $item.p
    $button.Add_Click({
        $map = @{'/start'='Activando';'/pause'='Pausando';'/resume'='Continuando';'/stop'='Deteniendo'}
        [void](Invoke-Aria ([string]$this.Tag) $map[[string]$this.Tag])
    })
    $buttonPanel.Controls.Add($button)
}

$footer = New-Object System.Windows.Forms.Label
$footer.Text = 'La nube puede continuar los ciclos autónomos aunque cierres esta ventana. Esta pantalla solo controla y observa el estado local.'
$footer.ForeColor = C 'LightSteelBlue'
$footer.AutoSize = $false
$footer.Size = New-Object System.Drawing.Size(1020, 34)
$footer.Location = New-Object System.Drawing.Point(22, 700)
$form.Controls.Add($footer)

function Refresh-Ui {
    $s = Get-Status
    if ($null -eq $s) {
        $status.Text = '[OFFLINE] CONTROLADOR LOCAL'
        $statusDot.ForeColor = C 'IndianRed'
        $status.ForeColor = C 'Salmon'
        $connection.Text = '● OFFLINE'
        $connection.ForeColor = C 'Salmon'
        $session.Text = 'Sesion: —'
        $mode.Text = 'Modo: —'
        $goal.Text = 'Objetivo: —'
        $next.Text = 'Próxima acción: —'
        foreach ($m in $metricPanels) { $m.Text = '—' }
        return
    }

    $modeValue = [string]$s.mode
    switch ($modeValue) {
        'active' { $status.Text = 'ACTIVA'; $statusDot.ForeColor = C 'LightGreen'; $status.ForeColor = C 'LightGreen' }
        'paused' { $status.Text = 'EN PAUSA'; $statusDot.ForeColor = C 'Khaki'; $status.ForeColor = C 'Khaki' }
        'stopped' { $status.Text = 'DETENIDA'; $statusDot.ForeColor = C 'IndianRed'; $status.ForeColor = C 'Salmon' }
        default { $status.Text = ($modeValue.ToUpperInvariant()); $statusDot.ForeColor = C 'LightSteelBlue'; $status.ForeColor = C 'White' }
    }
    $connection.Text = '● LOCAL ONLINE'
    $connection.ForeColor = C 'LightGreen'
    $session.Text = "Sesion: $([string]$s.session_id)"
    $mode.Text = "Modo actual: $modeValue"
    $goal.Text = "Objetivo: $([string]$s.active_goal)`r`nMisión: $([string]$s.active_mission_id)"

    $r = $s.last_result
    $runtime = $null
    $candidateCount = '-'
    $generatedCount = '0'
    $runtimeStatus = '-'
    if ($null -ne $r) {
        $runtime = $r.runtime
        $runtimeStatus = if ($runtime -and $runtime.status) { [string]$runtime.status } else { [string]$r.status }
        if ($null -ne $r.candidate_count) { $candidateCount = [string]$r.candidate_count }
        if ($null -ne $r.generated_count) { $generatedCount = [string]$r.generated_count }
    }

    $metricPanels[0].Text = [string]$s.tick_count
    $metricPanels[1].Text = if ($s.active_mission_id) { ([string]$s.active_mission_id).Replace('mission_','').Substring(0,[Math]::Min(12, ([string]$s.active_mission_id).Replace('mission_','').Length)) } else { '—' }
    $metricPanels[2].Text = $runtimeStatus
    $metricPanels[3].Text = $generatedCount
    $nextAction = if ($runtime -and $runtime.next_action) { [string]$runtime.next_action } elseif ($r -and $r.next_action) { [string]$r.next_action } else { 'sin acción reportada' }
    $next.Text = "Próxima acción: $nextAction"

    $a = Get-ActivityLog
    if ($a -and $a.content) {
        $lines = ([string]$a.content) -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 20
        $log.Text = $lines -join [Environment]::NewLine
        $log.SelectionStart = $log.TextLength
        $log.ScrollToCaret()
    }
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1500
$timer.Add_Tick({ Refresh-Ui })
$timer.Start()
Refresh-Ui
[void]$form.ShowDialog()
