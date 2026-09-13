param([int]$Port = 45873)
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$base = "http://127.0.0.1:$Port"
$heartbeatSeconds = 30
$lastTickAt = $null

function Invoke-Aria([string]$path) {
    try {
        $result = Invoke-RestMethod -Method Post -Uri "$base$path" -TimeoutSec 5
        Refresh-Ui
        return $result
    } catch {
        [System.Windows.Forms.MessageBox]::Show("ARIA Agent no responde.`r`n`r`nRuta: $path`r`nError: $($_.Exception.Message)", 'ARIA — Meditación IA', 'OK', 'Warning') | Out-Null
        Refresh-Ui
        return $null
    }
}

function Get-Status {
    try { return Invoke-RestMethod -Method Get -Uri "$base/status" -TimeoutSec 3 }
    catch { return $null }
}

function Get-ActivityLog {
    try { return Invoke-RestMethod -Method Get -Uri "$base/log" -TimeoutSec 3 }
    catch { return $null }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ARIA — Meditación IA'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(720, 560)
$form.MinimumSize = New-Object System.Drawing.Size(720, 560)
$form.MaximizeBox = $false
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'ARIA — MEDITACIÓN IA'
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
$status.Size = New-Object System.Drawing.Size(650, 32)
$status.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$status.Location = New-Object System.Drawing.Point(30, 82)
$form.Controls.Add($status)

$mode = New-Object System.Windows.Forms.Label
$mode.AutoSize = $false
$mode.Size = New-Object System.Drawing.Size(320, 55)
$mode.Location = New-Object System.Drawing.Point(30, 120)
$form.Controls.Add($mode)

$mission = New-Object System.Windows.Forms.Label
$mission.AutoSize = $false
$mission.Size = New-Object System.Drawing.Size(320, 55)
$mission.Location = New-Object System.Drawing.Point(365, 120)
$form.Controls.Add($mission)

$heartbeat = New-Object System.Windows.Forms.Label
$heartbeat.AutoSize = $false
$heartbeat.Size = New-Object System.Drawing.Size(650, 28)
$heartbeat.ForeColor = [System.Drawing.Color]::DimGray
$heartbeat.Location = New-Object System.Drawing.Point(30, 178)
$form.Controls.Add($heartbeat)

$log = New-Object System.Windows.Forms.TextBox
$log.Multiline = $true
$log.ReadOnly = $true
$log.ScrollBars = 'Vertical'
$log.Font = New-Object System.Drawing.Font('Consolas', 9)
$log.Location = New-Object System.Drawing.Point(30, 215)
$log.Size = New-Object System.Drawing.Size(650, 190)
$form.Controls.Add($log)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = 'PAUSAR conserva la sesión. DETENER guarda checkpoint y libera la capa de continuidad.'
$hint.AutoSize = $true
$hint.ForeColor = [System.Drawing.Color]::DimGray
$hint.Location = New-Object System.Drawing.Point(30, 415)
$form.Controls.Add($hint)

$buttons = @(
    @{t='ACTIVAR'; x=30;  p='/start'},
    @{t='PAUSAR';  x=190; p='/pause'},
    @{t='CONTINUAR'; x=350; p='/resume'},
    @{t='DETENER'; x=530; p='/stop'}
)
foreach ($item in $buttons) {
    $button = New-Object System.Windows.Forms.Button
    $button.Text = $item.t
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $button.Size = New-Object System.Drawing.Size(145, 44)
    $button.Location = New-Object System.Drawing.Point($item.x, 450)
    $route = $item.p
    $button.Add_Click({ [void](Invoke-Aria $route) })
    $form.Controls.Add($button)
}

function Refresh-Ui {
    $s = Get-Status
    if ($null -eq $s) {
        $status.Text = '● OFFLINE — ARIA Local Agent no responde'
        $status.ForeColor = [System.Drawing.Color]::Firebrick
        $mode.Text = 'Modo: —`r`nSesión: —'
        $mission.Text = 'Objetivo: —`r`nMisión: —'
        $heartbeat.Text = 'Control loopback: 127.0.0.1:' + $Port
        return
    }

    $status.Text = "● ONLINE — Modo: $($s.mode.ToUpperInvariant())"
    $status.ForeColor = if ($s.mode -eq 'active') { [System.Drawing.Color]::ForestGreen } elseif ($s.mode -eq 'paused') { [System.Drawing.Color]::DarkOrange } else { [System.Drawing.Color]::DimGray }
    $mode.Text = "Modo: $($s.mode)`r`nSesión: $([string]$s.session_id)"
    $mission.Text = "Objetivo: $([string]$s.active_goal)`r`nMisión: $([string]$s.active_mission_id)"
    $lastTickAt = $s.last_tick_at
    if ($lastTickAt) {
        try {
            $elapsed = [int](([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($lastTickAt)).TotalSeconds)
            $remaining = [Math]::Max(0, $heartbeatSeconds - $elapsed)
            $heartbeat.Text = "Tick #$($s.tick_count)  |  Último tick: $elapsed s  |  Próxima revisión estimada: $remaining s"
        } catch { $heartbeat.Text = "Tick #$($s.tick_count)  |  Último tick: $lastTickAt" }
    } else {
        $heartbeat.Text = "Tick #$($s.tick_count)  |  Heartbeat configurado: $heartbeatSeconds s"
    }

    $r = Get-ActivityLog
    if ($r -and $r.content) {
        $lines = ([string]$r.content) -split "`r?`n" | Where-Object { $_ } | Select-Object -Last 18
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
