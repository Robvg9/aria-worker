$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$scope = [System.Windows.Automation.TreeScope]::Descendants
$all = $root.FindAll($scope, [System.Windows.Automation.Condition]::TrueCondition)
$nodes = New-Object System.Collections.ArrayList

for ($i = 0; $i -lt $all.Count -and $nodes.Count -lt 350; $i++) {
    $el = $all.Item($i)
    try {
        $c = $el.Current
        if ($c.IsOffscreen -or [string]::IsNullOrWhiteSpace($c.Name)) { continue }
        $typeName = [string]$c.ControlType.ProgrammaticName
        $role = ($typeName -replace '^ControlType\.', '').ToLowerInvariant()
        $rect = $c.BoundingRectangle
        $isPassword = $false
        try { $isPassword = [bool]$el.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsPasswordProperty) } catch {}
        if ($isPassword) { continue }

        $node = [PSCustomObject]@{
            id = if ($c.AutomationId) { [string]$c.AutomationId } else { "uia-$($i)-$([int]$c.NativeWindowHandle)" }
            role = $role
            name = [string]$c.Name
            text = [string]$c.Name
            label = [string]$c.Name
            enabled = [bool]$c.IsEnabled
            visible = -not [bool]$c.IsOffscreen
            attributes = [PSCustomObject]@{
                automation_id = [string]$c.AutomationId
                control_type = $typeName
                hwnd = [int]$c.NativeWindowHandle
                x = [int][math]::Round($rect.X)
                y = [int][math]::Round($rect.Y)
                width = [int][math]::Round($rect.Width)
                height = [int][math]::Round($rect.Height)
            }
        }
        [void]$nodes.Add($node)
    } catch {}
}

$result = [PSCustomObject]@{
    status = 'succeeded'
    action = 'observe'
    ui = [PSCustomObject]@{
        version = 'ui-state-v1.0.1'
        surface = 'windows-desktop'
        url = $null
        title = $null
        focused_id = $null
        nodes = @($nodes)
        metadata = [PSCustomObject]@{ source = 'windows-uia'; node_count = $nodes.Count }
    }
}

$result | ConvertTo-Json -Compress -Depth 12
