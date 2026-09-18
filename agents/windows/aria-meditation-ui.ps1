# Control routes: /status /log /start /pause /resume /stop | Center routes: /catalog /queue /queue/add /queue/remove /queue/reorder /queue/run-next /notifications /notifications/read /human-gate/complete
param(
  [int]$Port = 45873
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$BaseUrl = "http://127.0.0.1:$Port"

function Invoke-CenterApi {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Path,
    [object]$Body = $null
  )

  try {
    $uri = "$BaseUrl$Path"
    if ($null -eq $Body) {
      return Invoke-RestMethod -Method $Method -Uri $uri -TimeoutSec 15 -ErrorAction Stop
    }

    $json = $Body | ConvertTo-Json -Depth 12 -Compress
    return Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json' -Body $json -TimeoutSec 15 -ErrorAction Stop
  }
  catch {
    return $null
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'ARIA - MEDITACION IA'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1220, 820)
$form.MinimumSize = New-Object System.Drawing.Size(1100, 760)
$form.Font = New-Object System.Drawing.Font('Segoe UI', 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'ARIA - MEDITACION IA'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 20, [System.Drawing.FontStyle]::Bold)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(20, 15)
$form.Controls.Add($title)

$online = New-Object System.Windows.Forms.Label
$online.Text = '[OFFLINE]'
$online.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$online.AutoSize = $true
$online.Location = New-Object System.Drawing.Point(20, 55)
$form.Controls.Add($online)

$sessionInfo = New-Object System.Windows.Forms.Label
$sessionInfo.AutoSize = $true
$sessionInfo.Location = New-Object System.Drawing.Point(190, 60)
$form.Controls.Add($sessionInfo)

$activate = New-Object System.Windows.Forms.Button
$activate.Text = 'ACTIVAR'
$activate.Size = New-Object System.Drawing.Size(90, 34)
$activate.Location = New-Object System.Drawing.Point(790, 18)
$form.Controls.Add($activate)

$pause = New-Object System.Windows.Forms.Button
$pause.Text = 'PAUSAR'
$pause.Size = New-Object System.Drawing.Size(90, 34)
$pause.Location = New-Object System.Drawing.Point(890, 18)
$form.Controls.Add($pause)

$continue = New-Object System.Windows.Forms.Button
$continue.Text = 'CONTINUAR'
$continue.Size = New-Object System.Drawing.Size(90, 34)
$continue.Location = New-Object System.Drawing.Point(990, 18)
$form.Controls.Add($continue)

$stop = New-Object System.Windows.Forms.Button
$stop.Text = 'DETENER'
$stop.Size = New-Object System.Drawing.Size(90, 34)
$stop.Location = New-Object System.Drawing.Point(1090, 18)
$form.Controls.Add($stop)

$message = New-Object System.Windows.Forms.Label
$message.AutoSize = $false
$message.Size = New-Object System.Drawing.Size(1150, 28)
$message.Location = New-Object System.Drawing.Point(20, 88)
$message.Font = New-Object System.Drawing.Font('Consolas', 9, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($message)

$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Location = New-Object System.Drawing.Point(20, 120)
$tabs.Size = New-Object System.Drawing.Size(1165, 650)
$form.Controls.Add($tabs)

$centerTab = New-Object System.Windows.Forms.TabPage
$centerTab.Text = 'CENTRO'
[void]$tabs.TabPages.Add($centerTab)

$catalogTab = New-Object System.Windows.Forms.TabPage
$catalogTab.Text = 'CATÁLOGO'
[void]$tabs.TabPages.Add($catalogTab)

$queueTab = New-Object System.Windows.Forms.TabPage
$queueTab.Text = 'COLA MANUAL'
[void]$tabs.TabPages.Add($queueTab)

$notificationsTab = New-Object System.Windows.Forms.TabPage
$notificationsTab.Text = 'NOTIFICACIONES'
[void]$tabs.TabPages.Add($notificationsTab)

$ideaTab = New-Object System.Windows.Forms.TabPage
$ideaTab.Text = 'IDEA → MISIÓN'
[void]$tabs.TabPages.Add($ideaTab)

$activeTitle = New-Object System.Windows.Forms.Label
$activeTitle.AutoSize = $false
$activeTitle.Size = New-Object System.Drawing.Size(1100, 44)
$activeTitle.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$activeTitle.Location = New-Object System.Drawing.Point(18, 15)
$centerTab.Controls.Add($activeTitle)

$activeProgress = New-Object System.Windows.Forms.Label
$activeProgress.AutoSize = $true
$activeProgress.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$activeProgress.Location = New-Object System.Drawing.Point(18, 62)
$centerTab.Controls.Add($activeProgress)

$activeGate = New-Object System.Windows.Forms.Label
$activeGate.AutoSize = $false
$activeGate.Size = New-Object System.Drawing.Size(1100, 34)
$activeGate.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
$activeGate.Location = New-Object System.Drawing.Point(18, 95)
$centerTab.Controls.Add($activeGate)

$activeGateConfirm = New-Object System.Windows.Forms.Button
$activeGateConfirm.Text = 'CONFIRMAR HUMAN GATE'
$activeGateConfirm.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$activeGateConfirm.Size = New-Object System.Drawing.Size(270, 40)
$activeGateConfirm.Location = New-Object System.Drawing.Point(820, 92)
$activeGateConfirm.Visible = $false
$centerTab.Controls.Add($activeGateConfirm)

$activeDetail = New-Object System.Windows.Forms.RichTextBox
$activeDetail.ReadOnly = $true
$activeDetail.Location = New-Object System.Drawing.Point(18, 135)
$activeDetail.Size = New-Object System.Drawing.Size(720, 180)
$centerTab.Controls.Add($activeDetail)

$telemetrySummary = New-Object System.Windows.Forms.Label
$telemetrySummary.AutoSize = $false
$telemetrySummary.Size = New-Object System.Drawing.Size(1100, 55)
$telemetrySummary.Font = New-Object System.Drawing.Font('Consolas', 9)
$telemetrySummary.Location = New-Object System.Drawing.Point(18, 570)
$centerTab.Controls.Add($telemetrySummary)

$stepsGrid = New-Object System.Windows.Forms.DataGridView
$stepsGrid.Location = New-Object System.Drawing.Point(18, 330)
$stepsGrid.Size = New-Object System.Drawing.Size(1100, 230)
$stepsGrid.ReadOnly = $true
$stepsGrid.AllowUserToAddRows = $false
$stepsGrid.RowHeadersVisible = $false
$stepsGrid.SelectionMode = 'FullRowSelect'
$stepsGrid.AutoSizeColumnsMode = 'Fill'
[void]$stepsGrid.Columns.Add('number', 'Paso')
[void]$stepsGrid.Columns.Add('description', 'Descripcion')
[void]$stepsGrid.Columns.Add('status', 'Estado')
[void]$stepsGrid.Columns.Add('risk', 'Riesgo')
[void]$stepsGrid.Columns.Add('executor', 'Executor')
$centerTab.Controls.Add($stepsGrid)

$catalogSearch = New-Object System.Windows.Forms.TextBox
$catalogSearch.Location = New-Object System.Drawing.Point(15, 15)
$catalogSearch.Size = New-Object System.Drawing.Size(400, 28)
$catalogTab.Controls.Add($catalogSearch)

$catalogCount = New-Object System.Windows.Forms.Label
$catalogCount.AutoSize = $true
$catalogCount.Location = New-Object System.Drawing.Point(430, 20)
$catalogTab.Controls.Add($catalogCount)

$catalogGrid = New-Object System.Windows.Forms.DataGridView
$catalogGrid.Location = New-Object System.Drawing.Point(15, 55)
$catalogGrid.Size = New-Object System.Drawing.Size(1115, 300)
$catalogGrid.ReadOnly = $true
$catalogGrid.AllowUserToAddRows = $false
$catalogGrid.SelectionMode = 'FullRowSelect'
$catalogGrid.MultiSelect = $false
$catalogGrid.RowHeadersVisible = $false
$catalogGrid.AutoSizeColumnsMode = 'Fill'
[void]$catalogGrid.Columns.Add('title', 'Mision')
[void]$catalogGrid.Columns.Add('status', 'Estado')
[void]$catalogGrid.Columns.Add('progress', 'Progreso')
[void]$catalogGrid.Columns.Add('gate', 'Human Gate')
[void]$catalogGrid.Columns.Add('priority', 'Prioridad')
[void]$catalogGrid.Columns.Add('source', 'Origen')
$catalogTab.Controls.Add($catalogGrid)

$catalogDetail = New-Object System.Windows.Forms.RichTextBox
$catalogDetail.ReadOnly = $true
$catalogDetail.Location = New-Object System.Drawing.Point(15, 370)
$catalogDetail.Size = New-Object System.Drawing.Size(800, 220)
$catalogTab.Controls.Add($catalogDetail)

$addQueue = New-Object System.Windows.Forms.Button
$addQueue.Text = 'AGREGAR A COLA'
$addQueue.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$addQueue.Size = New-Object System.Drawing.Size(240, 52)
$addQueue.Location = New-Object System.Drawing.Point(850, 390)
$catalogTab.Controls.Add($addQueue)

$refreshCatalog = New-Object System.Windows.Forms.Button
$refreshCatalog.Text = 'ACTUALIZAR'
$refreshCatalog.Size = New-Object System.Drawing.Size(240, 42)
$refreshCatalog.Location = New-Object System.Drawing.Point(850, 455)
$catalogTab.Controls.Add($refreshCatalog)

$queueCount = New-Object System.Windows.Forms.Label
$queueCount.AutoSize = $true
$queueCount.Location = New-Object System.Drawing.Point(15, 15)
$queueTab.Controls.Add($queueCount)

$queueGrid = New-Object System.Windows.Forms.DataGridView
$queueGrid.Location = New-Object System.Drawing.Point(15, 48)
$queueGrid.Size = New-Object System.Drawing.Size(1115, 380)
$queueGrid.ReadOnly = $true
$queueGrid.AllowUserToAddRows = $false
$queueGrid.SelectionMode = 'FullRowSelect'
$queueGrid.MultiSelect = $false
$queueGrid.RowHeadersVisible = $false
$queueGrid.AutoSizeColumnsMode = 'Fill'
[void]$queueGrid.Columns.Add('position', 'Posicion')
[void]$queueGrid.Columns.Add('type', 'Tipo')
[void]$queueGrid.Columns.Add('reference', 'Referencia')
[void]$queueGrid.Columns.Add('status', 'Estado')
[void]$queueGrid.Columns.Add('mission', 'Mision resuelta')
$queueTab.Controls.Add($queueGrid)

$queueUp = New-Object System.Windows.Forms.Button
$queueUp.Text = 'SUBIR'
$queueUp.Size = New-Object System.Drawing.Size(120, 44)
$queueUp.Location = New-Object System.Drawing.Point(15, 450)
$queueTab.Controls.Add($queueUp)

$queueDown = New-Object System.Windows.Forms.Button
$queueDown.Text = 'BAJAR'
$queueDown.Size = New-Object System.Drawing.Size(120, 44)
$queueDown.Location = New-Object System.Drawing.Point(150, 450)
$queueTab.Controls.Add($queueDown)

$queueRemove = New-Object System.Windows.Forms.Button
$queueRemove.Text = 'QUITAR'
$queueRemove.Size = New-Object System.Drawing.Size(120, 44)
$queueRemove.Location = New-Object System.Drawing.Point(285, 450)
$queueTab.Controls.Add($queueRemove)

$queueRun = New-Object System.Windows.Forms.Button
$queueRun.Text = 'EJECUTAR SIGUIENTE'
$queueRun.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$queueRun.Size = New-Object System.Drawing.Size(220, 44)
$queueRun.Location = New-Object System.Drawing.Point(430, 450)
$queueTab.Controls.Add($queueRun)

$queueRefresh = New-Object System.Windows.Forms.Button
$queueRefresh.Text = 'ACTUALIZAR COLA'
$queueRefresh.Size = New-Object System.Drawing.Size(180, 44)
$queueRefresh.Location = New-Object System.Drawing.Point(665, 450)
$queueTab.Controls.Add($queueRefresh)

$notificationsCount = New-Object System.Windows.Forms.Label
$notificationsCount.AutoSize = $true
$notificationsCount.Location = New-Object System.Drawing.Point(15, 15)
$notificationsTab.Controls.Add($notificationsCount)

$notificationGrid = New-Object System.Windows.Forms.DataGridView
$notificationGrid.Location = New-Object System.Drawing.Point(15, 48)
$notificationGrid.Size = New-Object System.Drawing.Size(1115, 360)
$notificationGrid.ReadOnly = $true
$notificationGrid.AllowUserToAddRows = $false
$notificationGrid.SelectionMode = 'FullRowSelect'
$notificationGrid.MultiSelect = $false
$notificationGrid.RowHeadersVisible = $false
$notificationGrid.AutoSizeColumnsMode = 'Fill'
[void]$notificationGrid.Columns.Add('time', 'Fecha')
[void]$notificationGrid.Columns.Add('severity', 'Nivel')
[void]$notificationGrid.Columns.Add('title', 'Notificacion')
[void]$notificationGrid.Columns.Add('kind', 'Tipo')
[void]$notificationGrid.Columns.Add('state', 'Estado')
$notificationsTab.Controls.Add($notificationGrid)

$notificationDetail = New-Object System.Windows.Forms.RichTextBox
$notificationDetail.ReadOnly = $true
$notificationDetail.Location = New-Object System.Drawing.Point(15, 425)
$notificationDetail.Size = New-Object System.Drawing.Size(760, 165)
$notificationsTab.Controls.Add($notificationDetail)

$notificationRefresh = New-Object System.Windows.Forms.Button
$notificationRefresh.Text = 'ACTUALIZAR'
$notificationRefresh.Size = New-Object System.Drawing.Size(160, 44)
$notificationRefresh.Location = New-Object System.Drawing.Point(800, 430)
$notificationsTab.Controls.Add($notificationRefresh)

$notificationMarkRead = New-Object System.Windows.Forms.Button
$notificationMarkRead.Text = 'MARCAR LEIDA'
$notificationMarkRead.Size = New-Object System.Drawing.Size(160, 44)
$notificationMarkRead.Location = New-Object System.Drawing.Point(975, 430)
$notificationsTab.Controls.Add($notificationMarkRead)

$notificationMarkAllRead = New-Object System.Windows.Forms.Button
$notificationMarkAllRead.Text = 'MARCAR TODO LEIDO'
$notificationMarkAllRead.Size = New-Object System.Drawing.Size(335, 44)
$notificationMarkAllRead.Location = New-Object System.Drawing.Point(800, 485)
$notificationsTab.Controls.Add($notificationMarkAllRead)

$ideaLabel = New-Object System.Windows.Forms.Label
$ideaLabel.Text = 'Escribe la mejora que quieres que ARIA convierta en trabajo estructurado. No se ejecuta ni se autoencola.'
$ideaLabel.AutoSize = $false
$ideaLabel.Size = New-Object System.Drawing.Size(1080, 42)
$ideaLabel.Location = New-Object System.Drawing.Point(18, 18)
$ideaTab.Controls.Add($ideaLabel)

$ideaInput = New-Object System.Windows.Forms.TextBox
$ideaInput.Multiline = $true
$ideaInput.ScrollBars = 'Vertical'
$ideaInput.Location = New-Object System.Drawing.Point(18, 68)
$ideaInput.Size = New-Object System.Drawing.Size(1080, 105)
$ideaTab.Controls.Add($ideaInput)

$ideaAnalyze = New-Object System.Windows.Forms.Button
$ideaAnalyze.Text = 'ANALIZAR Y PROPONER'
$ideaAnalyze.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$ideaAnalyze.Size = New-Object System.Drawing.Size(240, 44)
$ideaAnalyze.Location = New-Object System.Drawing.Point(18, 185)
$ideaTab.Controls.Add($ideaAnalyze)

$ideaRefresh = New-Object System.Windows.Forms.Button
$ideaRefresh.Text = 'ACTUALIZAR PROPUESTAS'
$ideaRefresh.Size = New-Object System.Drawing.Size(220, 44)
$ideaRefresh.Location = New-Object System.Drawing.Point(275, 185)
$ideaTab.Controls.Add($ideaRefresh)

$ideaStatus = New-Object System.Windows.Forms.Label
$ideaStatus.AutoSize = $true
$ideaStatus.Location = New-Object System.Drawing.Point(520, 198)
$ideaTab.Controls.Add($ideaStatus)

$ideaDetail = New-Object System.Windows.Forms.RichTextBox
$ideaDetail.ReadOnly = $true
$ideaDetail.Location = New-Object System.Drawing.Point(18, 245)
$ideaDetail.Size = New-Object System.Drawing.Size(1080, 330)
$ideaTab.Controls.Add($ideaDetail)

function Set-CenterMessage {
  param([string]$Text, [bool]$IsError = $false)
  $message.Text = $Text
  if ($IsError) {
    $message.ForeColor = [System.Drawing.Color]::Firebrick
  } else {
    $message.ForeColor = [System.Drawing.Color]::DarkGreen
  }
}

function Get-ActivityLog {`n  return Invoke-CenterApi -Method 'GET' -Path '/log'`n}`n`nfunction Get-Catalog {
  return Invoke-CenterApi -Method 'GET' -Path '/catalog'
}

function Get-Queue {
  return Invoke-CenterApi -Method 'GET' -Path '/queue'
}

function Get-Status {
  return Invoke-CenterApi -Method 'GET' -Path '/status'
}

function Get-Notifications {
  return Invoke-CenterApi -Method 'GET' -Path '/notifications'
}

function Get-SelectedNotification {
  param([object]$Model)

  if ($notificationGrid.SelectedRows.Count -lt 1 -or $null -eq $Model) {
    return $null
  }

  $id = [string]$notificationGrid.SelectedRows[0].Tag
  foreach ($item in @($Model.notifications)) {
    if ([string]$item.notification_id -eq $id) {
      return $item
    }
  }
  return $null
}

function Get-SelectedCatalogItem {
  param([object]$Catalog)

  if ($catalogGrid.SelectedRows.Count -lt 1) {
    return $null
  }
  if ($null -eq $Catalog) {
    return $null
  }

  $id = [string]$catalogGrid.SelectedRows[0].Tag
  foreach ($item in @($Catalog.items)) {
    if ([string]$item.id -eq $id) {
      return $item
    }
  }
  return $null
}

function Refresh-Catalog {
  $catalog = Get-Catalog
  $catalogGrid.Rows.Clear()

  if ($null -eq $catalog -or $null -eq $catalog.items) {
    $catalogCount.Text = 'Misiones visibles: sin conexion'
    return
  }

  $needle = $catalogSearch.Text.Trim().ToLowerInvariant()
  foreach ($item in @($catalog.items)) {
    $haystack = ("$($item.title) $($item.summary) $($item.status) $($item.source_type)").ToLowerInvariant()
    if ($needle.Length -gt 0 -and -not $haystack.Contains($needle)) {
      continue
    }

    $rowIndex = $catalogGrid.Rows.Add(
      [string]$item.title,
      [string]$item.status,
      ([string]$item.progress_percent + '%'),
      [string]$item.human_gate.label,
      [string]$item.priority,
      [string]$item.source_type
    )
    $catalogGrid.Rows[$rowIndex].Tag = $item.id
  }

  $catalogCount.Text = "Misiones visibles: $($catalogGrid.Rows.Count)"
}

function Show-CatalogDetail {
  $catalog = Get-Catalog
  $item = Get-SelectedCatalogItem -Catalog $catalog
  if ($null -eq $item) {
    $catalogDetail.Text = ''
    return
  }

  $nl = [Environment]::NewLine
  $catalogDetail.Text =
    ('TITULO:' + $nl + [string]$item.title + $nl + $nl +
     'RESULTADO:' + $nl + [string]$item.result + $nl + $nl +
     'SOLUCIÓN:' + $nl + [string]$item.solution + $nl + $nl +
     'MEJORA ARIA:' + $nl + [string]$item.improvement + $nl + $nl +
     'ESTADO: ' + [string]$item.status + ' | PROGRESO: ' + [string]$item.progress_percent + '%' + $nl +
     'HUMAN GATE: ' + [string]$item.human_gate.label + $nl +
     'RIESGO: ' + [string]$item.risk + ' | ORIGEN: ' + [string]$item.source_type + $nl + $nl +
     'DESCRIPCION TECNICA:' + $nl + [string]$item.technical_description + $nl + $nl +
     'DEPENDENCIAS:' + $nl + [string]($item.dependencies -join ', '))
}

function Refresh-Queue {
  $queue = Get-Queue
  $queueGrid.Rows.Clear()

  if ($null -eq $queue -or $null -eq $queue.items) {
    $queueCount.Text = 'Cola manual: sin conexion'
    return
  }

  foreach ($item in @($queue.items)) {
    if ([string]$item.status -notin @('queued','running','paused','failed','blocked')) {
      continue
    }

    $rowIndex = $queueGrid.Rows.Add(
      [string]$item.position,
      [string]$item.item_type,
      [string]$item.item_id,
      [string]$item.status,
      [string]$item.resolved_mission_id
    )
    $queueGrid.Rows[$rowIndex].Tag = $item.queue_id
  }

  $queueCount.Text = "Cola manual: $($queueGrid.Rows.Count)"
}

function Refresh-Notifications {
  $model = Get-Notifications
  $notificationGrid.Rows.Clear()

  if ($null -eq $model -or $null -eq $model.notifications) {
    $notificationsCount.Text = 'Notificaciones: sin conexion'
    $notificationsTab.Text = 'NOTIFICACIONES'
    $notificationDetail.Text = ''
    return
  }

  $unread = [int]$model.unread_count
  $notificationsCount.Text = "Notificaciones: $($model.notifications.Count) | Sin leer: $unread"
  $notificationsTab.Text = if ($unread -gt 0) { "NOTIFICACIONES ($unread)" } else { 'NOTIFICACIONES' }

  foreach ($item in @($model.notifications)) {
    $readState = if ($null -eq $item.read_at) { 'NUEVA' } else { 'LEIDA' }
    $time = try { ([DateTime]::Parse([string]$item.created_at)).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss') } catch { [string]$item.created_at }
    $rowIndex = $notificationGrid.Rows.Add(
      $time,
      [string]$item.severity,
      [string]$item.title,
      [string]$item.kind,
      $readState
    )
    $notificationGrid.Rows[$rowIndex].Tag = [string]$item.notification_id
  }
}

function Show-NotificationDetail {
  $model = Get-Notifications
  $item = Get-SelectedNotification -Model $model
  if ($null -eq $item) {
    $notificationDetail.Text = ''
    return
  }

  $nl = [Environment]::NewLine
  $notificationDetail.Text =
    ('TITULO:' + $nl + [string]$item.title + $nl + $nl +
     'MENSAJE:' + $nl + [string]$item.message + $nl + $nl +
     'TIPO: ' + [string]$item.kind + ' | NIVEL: ' + [string]$item.severity + $nl +
     'MISION: ' + [string]$item.mission_id + $nl +
     'ACCION: ' + [string]$item.action + $nl +
     'ESTADO: ' + $(if($null -eq $item.read_at){'NUEVA'}else{'LEIDA'}))
}

function Mark-SelectedNotificationRead {
  if ($notificationGrid.SelectedRows.Count -lt 1) {
    return
  }

  $id = [string]$notificationGrid.SelectedRows[0].Tag
  $result = Invoke-CenterApi -Method 'POST' -Path '/notifications/read' -Body @{
    notification_ids = @($id)
  }

  if ($null -eq $result -or $result.ok -ne $true) {
    Set-CenterMessage -Text ('ERROR NOTIFICACION: ' + [string]$result.error) -IsError $true
    return
  }

  Set-CenterMessage -Text 'NOTIFICACIONES: marcada como leida.'
  Refresh-Notifications
}

function Mark-AllNotificationsRead {
  $result = Invoke-CenterApi -Method 'POST' -Path '/notifications/read' -Body @{
    all = $true
  }

  if ($null -eq $result -or $result.ok -ne $true) {
    Set-CenterMessage -Text ('ERROR NOTIFICACIONES: ' + [string]$result.error) -IsError $true
    return
  }

  Set-CenterMessage -Text 'NOTIFICACIONES: todas marcadas como leidas.'
  Refresh-Notifications
}

function Render-IdeaProposal {
  param([object]$Proposal)
  if ($null -eq $Proposal) {
    $ideaDetail.Text = ''
    return
  }
  $ideaDetail.Text = ($Proposal | ConvertTo-Json -Depth 16)
}

function Submit-IdeaProposal {
  $idea = $ideaInput.Text.Trim()
  if ([string]::IsNullOrWhiteSpace($idea)) {
    $ideaStatus.Text = 'Escribe una idea primero.'
    return
  }
  $result = Invoke-CenterApi -Method 'POST' -Path '/idea-to-mission' -Body @{ idea = $idea }
  if ($null -eq $result -or $result.ok -ne $true) {
    $ideaStatus.Text = 'ERROR: ' + [string]$result.error
    Set-CenterMessage -Text ('IDEA → MISION ERROR: ' + [string]$result.error) -IsError $true
    return
  }
  $ideaStatus.Text = if ($result.deduplicated) { 'PROPUESTA EXISTENTE — sin duplicar.' } else { 'PROPUESTA CREADA — NO AUTOENCOLADA.' }
  Render-IdeaProposal -Proposal $result.proposal
  Set-CenterMessage -Text 'IDEA → MISIÓN: propuesta estructurada y guardada. La cola sigue bajo decisión humana.'
}

function Refresh-IdeaProposals {
  $result = Invoke-CenterApi -Method 'GET' -Path '/ideas'
  if ($null -eq $result -or $null -eq $result.items) {
    $ideaStatus.Text = 'Sin conexión al registro de propuestas.'
    return
  }
  $ideaStatus.Text = 'Propuestas guardadas: ' + [string]$result.total + ' | Autoencolado: PROHIBIDO'
  if ($result.items.Count -gt 0) {
    $latest = $result.items[0]
    $ideaDetail.Text = ($latest | ConvertTo-Json -Depth 16)
  }
}

function Refresh-Center {
  $status = Get-Status
  $catalog = Get-Catalog

  if ($null -eq $status) {
    $online.Text = '[OFFLINE] ARIA Local Agent'
    $online.ForeColor = [System.Drawing.Color]::Firebrick
    return
  }

  $online.Text = '[ONLINE] MODO: ' + ([string]$status.mode).ToUpperInvariant()
  $online.ForeColor = [System.Drawing.Color]::DarkGreen
  $sessionInfo.Text = 'Sesion: ' + [string]$status.session_id + ' | Mision: ' + [string]$status.active_mission_id
  $lastResult = $status.last_result
  $runtimeStatus = '-'
  $candidateCount = '-'
  $learningScanned = '-'
  $learningCreated = '-'
  $nextAction = '-'
  $lastStatus = '-'
  if ($null -ne $lastResult) {
    if ($null -ne $lastResult.runtime -and $null -ne $lastResult.runtime.status) { $runtimeStatus = [string]$lastResult.runtime.status }
    if ($null -ne $lastResult.candidate_count) { $candidateCount = [string]$lastResult.candidate_count }
    if ($null -ne $lastResult.learning -and $null -ne $lastResult.learning.scanned) { $learningScanned = [string]$lastResult.learning.scanned }
    if ($null -ne $lastResult.learning -and $null -ne $lastResult.learning.created) { $learningCreated = [string]$lastResult.learning.created }
    if ($null -ne $lastResult.next_action) { $nextAction = [string]$lastResult.next_action }
    if ($null -ne $lastResult.status) { $lastStatus = [string]$lastResult.status }
  }
  $telemetrySummary.Text = 'RUNTIME: ' + $runtimeStatus + ' | Fabrica: ' + $candidateCount + ' candidatos | Aprendizaje: ' + $learningScanned + ' escaneados / ' + $learningCreated + ' creados | Proxima accion: ' + $nextAction + ' | Ultimo: ' + $lastStatus

  $missionId = [string]$status.active_mission_id
  $item = $null
  if ($null -ne $catalog) {
    foreach ($candidate in @($catalog.items)) {
      if ([string]$candidate.mission_id -eq $missionId) {
        $item = $candidate
        break
      }
    }
  }

  if ($null -eq $item) {
    $activeTitle.Text = 'MISION ACTIVA: ' + $missionId
    $activeProgress.Text = 'PROGRESO: sin datos'
    $activeGate.Text = 'HUMAN GATE: NO EXISTE MISION HUMANA'
    $activeGateConfirm.Visible = $false
    $activeDetail.Text = ''
    $stepsGrid.Rows.Clear()
    return
  }

  $activeTitle.Text = 'MISION ACTIVA: ' + [string]$item.title
  $activeProgress.Text = 'PROGRESO: ' + [string]$item.progress_percent + '% | PASOS: ' + [string]$item.progress_steps.completed + '/' + [string]$item.progress_steps.total
  $activeGate.Text = 'HUMAN GATE: ' + [string]$item.human_gate.label + $(if([string]$item.human_gate.method){' | METODO: ' + [string]$item.human_gate.method}else{''})
  $activeGateConfirm.Visible = ([bool]$item.human_gate.required -and [string]$item.human_gate.status -eq 'pending')
  $activeGateConfirm.Tag = $missionId

  $nl = [Environment]::NewLine
  $activeDetail.Text =
    ('RESULTADO:' + $nl + [string]$item.result + $nl + $nl +
     'SOLUCIÓN:' + $nl + [string]$item.solution + $nl + $nl +
     'MEJORA ARIA:' + $nl + [string]$item.improvement)

  $stepsGrid.Rows.Clear()
  foreach ($step in @($item.steps)) {
    [void]$stepsGrid.Rows.Add(
      [string]$step.index,
      [string]$step.title,
      [string]$step.status,
      [string]$step.risk,
      [string]$step.executor_type
    )
  }
}

function Confirm-HumanGate {
  $missionId = [string]$activeGateConfirm.Tag
  if ([string]::IsNullOrWhiteSpace($missionId)) {
    Set-CenterMessage -Text 'No hay Human Gate pendiente.' -IsError $true
    return
  }
  $answer = [System.Windows.Forms.MessageBox]::Show(
    'Confirma que has realizado la verificación humana indicada por ARIA para esta misión.',
    'Human Gate',
    [System.Windows.Forms.MessageBoxButtons]::YesNo,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  )
  if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { return }
  $result = Invoke-CenterApi -Method 'POST' -Path '/human-gate/complete' -Body @{
    mission_id = $missionId
    confirm = $true
    note = 'Confirmación manual desde Centro de Meditación IA'
  }
  if ($null -eq $result -or $result.ok -ne $true) {
    Set-CenterMessage -Text ('ERROR HUMAN GATE: ' + [string]$result.error) -IsError $true
    return
  }
  Set-CenterMessage -Text 'HUMAN GATE: verificación registrada. La misión puede continuar.'
  $activeGateConfirm.Visible = $false
  Refresh-Center
}

function Add-SelectedToQueue {
  $catalog = Get-Catalog
  $item = Get-SelectedCatalogItem -Catalog $catalog
  if ($null -eq $item) {
    Set-CenterMessage -Text 'Selecciona una mision primero.' -IsError $true
    return
  }

  if ([string]$item.status -in @('completed','blocked')) {
    Set-CenterMessage -Text 'La mision no puede entrar en la cola en su estado actual.' -IsError $true
    return
  }

  if ([string]$item.item_type -eq 'goal') {
    $itemType = 'goal'
    $itemId = [string]$item.goal_id
  } else {
    $itemType = 'mission'
    $itemId = [string]$item.mission_id
  }

  $result = Invoke-CenterApi -Method 'POST' -Path '/queue/add' -Body @{
    item_type = $itemType
    item_id = $itemId
  }

  if ($null -eq $result -or $result.ok -eq $false) {
    Set-CenterMessage -Text ('ERROR: ' + [string]$result.error) -IsError $true
    return
  }

  Set-CenterMessage -Text 'COLA: mision agregada correctamente.'
  Refresh-Queue
}

function Remove-SelectedQueueItem {
  if ($queueGrid.SelectedRows.Count -lt 1) {
    return
  }

  $queueId = [string]$queueGrid.SelectedRows[0].Tag
  $result = Invoke-CenterApi -Method 'POST' -Path '/queue/remove' -Body @{ queue_id = $queueId }

  if ($null -eq $result -or $result.ok -eq $false) {
    Set-CenterMessage -Text 'ERROR: no se pudo quitar de la cola.' -IsError $true
    return
  }

  Set-CenterMessage -Text 'COLA: elemento eliminado.'
  Refresh-Queue
}

function Reorder-SelectedQueueItem {
  param([int]$Delta)

  if ($queueGrid.SelectedRows.Count -lt 1) {
    return
  }

  $rows = @($queueGrid.Rows | Where-Object { $null -ne $_.Tag })
  $index = $queueGrid.SelectedRows[0].Index
  $target = $index + $Delta

  if ($target -lt 0 -or $target -ge $rows.Count) {
    return
  }

  $ids = @($rows | ForEach-Object { [string]$_.Tag })
  $tmp = $ids[$index]
  $ids[$index] = $ids[$target]
  $ids[$target] = $tmp

  $result = Invoke-CenterApi -Method 'POST' -Path '/queue/reorder' -Body @{ queue_ids = $ids }
  if ($null -eq $result -or $result.ok -eq $false) {
    Set-CenterMessage -Text 'ERROR: no se pudo reordenar.' -IsError $true
    return
  }

  Set-CenterMessage -Text 'COLA: orden actualizado.'
  Refresh-Queue
}

function Run-NextQueueItem {
  Set-CenterMessage -Text 'Ejecutando siguiente mision de la cola...'
  $result = Invoke-CenterApi -Method 'POST' -Path '/queue/run-next' -Body @{}

  if ($null -eq $result -or $result.ok -eq $false) {
    Set-CenterMessage -Text ('ERROR: ' + [string]$result.error) -IsError $true
    return
  }

  Set-CenterMessage -Text ('COLA: ' + [string]$result.status + ' | Mision: ' + [string]$result.mission_id)
  Refresh-Queue
  Refresh-Center
}

$activate.Add_Click({
  $result = Invoke-CenterApi -Method 'POST' -Path '/start' -Body @{}
  Set-CenterMessage -Text 'ACTIVAR ejecutado.'
  Refresh-Center
})

$pause.Add_Click({
  $result = Invoke-CenterApi -Method 'POST' -Path '/pause' -Body @{}
  Set-CenterMessage -Text 'PAUSAR ejecutado.'
  Refresh-Center
})

$continue.Add_Click({
  $result = Invoke-CenterApi -Method 'POST' -Path '/resume' -Body @{}
  Set-CenterMessage -Text 'CONTINUAR ejecutado.'
  Refresh-Center
})

$stop.Add_Click({
  $result = Invoke-CenterApi -Method 'POST' -Path '/stop' -Body @{}
  Set-CenterMessage -Text 'DETENER ejecutado.'
  Refresh-Center
})

$catalogSearch.Add_TextChanged({ Refresh-Catalog })
$catalogGrid.Add_SelectionChanged({ Show-CatalogDetail })
$addQueue.Add_Click({ Add-SelectedToQueue })
$activeGateConfirm.Add_Click({ Confirm-HumanGate })
$refreshCatalog.Add_Click({ Refresh-Catalog })
$queueUp.Add_Click({ Reorder-SelectedQueueItem -Delta -1 })
$queueDown.Add_Click({ Reorder-SelectedQueueItem -Delta 1 })
$queueRemove.Add_Click({ Remove-SelectedQueueItem })
$queueRun.Add_Click({ Run-NextQueueItem })
$queueRefresh.Add_Click({ Refresh-Queue })
$notificationGrid.Add_SelectionChanged({ Show-NotificationDetail })
$notificationRefresh.Add_Click({ Refresh-Notifications })
$notificationMarkRead.Add_Click({ Mark-SelectedNotificationRead })
$notificationMarkAllRead.Add_Click({ Mark-AllNotificationsRead })
$ideaAnalyze.Add_Click({ Submit-IdeaProposal })
$ideaRefresh.Add_Click({ Refresh-IdeaProposals })

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 3000
$timer.Add_Tick({
  try {
    Refresh-Center
    Refresh-Catalog
    Refresh-Queue
    Refresh-Notifications
    Refresh-IdeaProposals
  }
  catch {
    Set-CenterMessage -Text ('UI ERROR: ' + $_.Exception.Message) -IsError $true
  }
})
$timer.Start()

Refresh-Center
Refresh-Catalog
Refresh-Queue
Refresh-Notifications
Refresh-IdeaProposals
[void]$form.ShowDialog()
