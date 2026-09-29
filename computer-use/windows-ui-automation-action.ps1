$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
function Emit([hashtable]$v,[int]$code=0){$v|ConvertTo-Json -Compress -Depth 12;if($code-ne 0){exit $code}}
try{
  $raw=[Console]::In.ReadToEnd()
  if([string]::IsNullOrWhiteSpace($raw)){Emit @{status='failed';action='click';error='semantic_payload_missing'} 1}
  $p=$raw|ConvertFrom-Json;$action=[string]$p.action;$q=$p.target
  if($q -and $q.query){$q=$q.query}
  if($action -notin @('click','double_click')){Emit @{status='failed';action=$action;error='semantic_action_unsupported'} 1}
  if(-not $q){Emit @{status='failed';action=$action;error='semantic_target_missing'} 1}
  $fields=@('role','name','text','label','attribute')
  if(-not($fields|Where-Object{$null-ne$q.$_})){Emit @{status='failed';action=$action;error='semantic_query_empty'} 1}
  function Role($c){(([string]$c.ControlType.ProgrammaticName)-replace '^ControlType\.','').ToLowerInvariant()}
  function Match($c,$x){
    if($c.IsOffscreen -or -not$c.IsEnabled){return $false}
    $r=Role $c;$n=[string]$c.Name
    if($null-ne$x.role -and $r-ne([string]$x.role).ToLowerInvariant()){return $false}
    if($null-ne$x.name -and $n.ToLowerInvariant()-ne([string]$x.name).ToLowerInvariant()){return $false}
    if($null-ne$x.text -and -not$n.ToLowerInvariant().Contains(([string]$x.text).ToLowerInvariant())){return $false}
    if($null-ne$x.label -and -not$n.ToLowerInvariant().Contains(([string]$x.label).ToLowerInvariant())){return $false}
    if($x.attribute){
      foreach($a in $x.attribute.PSObject.Properties){
        $v=switch($a.Name){
          'automation_id'{[string]$c.AutomationId;break}
          'control_type'{[string]$c.ControlType.ProgrammaticName;break}
          'hwnd'{[string]$c.NativeWindowHandle;break}
          default{$null}
        }
        if($null-eq$v -or $v-ne[string]$a.Value){return $false}
      }
    }
    return $true
  }
  $root=[System.Windows.Automation.AutomationElement]::RootElement
  $all=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
  $matches=New-Object System.Collections.ArrayList
  for($i=0;$i-lt$all.Count;$i++){try{$el=$all.Item($i);if(Match $el.Current $q){[void]$matches.Add($el);if($matches.Count-gt 2){break}}}catch{}}
  if($matches.Count-eq 0){Emit @{status='failed';action=$action;error='semantic_target_not_found';executor='windows-uia-semantic'} 1}
  if($matches.Count-gt 1){Emit @{status='failed';action=$action;error='semantic_target_ambiguous';executor='windows-uia-semantic';candidates=@($matches|ForEach-Object{try{[string]$_.Current.Name}catch{''}}|Select-Object -First 8)} 1}
  $el=$matches[0]
  $times=if($action-eq'double_click'){2}else{1}
  $method=$null
  for($i=0;$i-lt$times;$i++){
    $ok=$false
    try{$pat=$el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern);([System.Windows.Automation.InvokePattern]$pat).Invoke();$method='InvokePattern';$ok=$true}catch{}
    if(-not$ok){try{$pat=$el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern);([System.Windows.Automation.SelectionItemPattern]$pat).Select();$method='SelectionItemPattern';$ok=$true}catch{}}
    if(-not$ok){try{$pat=$el.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern);([System.Windows.Automation.TogglePattern]$pat).Toggle();$method='TogglePattern';$ok=$true}catch{}}
    if(-not$ok){Emit @{status='failed';action=$action;error='semantic_invoke_pattern_unavailable';executor='windows-uia-semantic'} 1}
    if($times-eq 2 -and $i-eq 0){Start-Sleep -Milliseconds 70}
  }
  $c=$el.Current;$r=$c.BoundingRectangle
  Emit @{status='succeeded';action=$action;executor='windows-uia-semantic';method=$method;matched=@{id=if($c.AutomationId){'uia-'+[string]$c.AutomationId}else{'uia-'+[int]$c.NativeWindowHandle+'-'+$c.Name.GetHashCode()};role=Role $c;name=[string]$c.Name;enabled=[bool]$c.IsEnabled;visible=-not[bool]$c.IsOffscreen;attributes=@{automation_id=[string]$c.AutomationId;control_type=[string]$c.ControlType.ProgrammaticName;hwnd=[int]$c.NativeWindowHandle;x=[int][math]::Round($r.X);y=[int][math]::Round($r.Y);width=[int][math]::Round($r.Width);height=[int][math]::Round($r.Height)}}}
}catch{Emit @{status='failed';action='click';error=('semantic_uia_exception: '+$_.Exception.Message)} 1}
