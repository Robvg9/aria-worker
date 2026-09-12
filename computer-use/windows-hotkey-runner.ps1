$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Emit-Result([hashtable]$value, [int]$exitCode = 0) {
    $value | ConvertTo-Json -Compress -Depth 8
    if ($exitCode -ne 0) { exit $exitCode }
}

function KeyToSendKeys([string]$key) {
    $k = $key.Trim().ToUpperInvariant()
    $special = @{
        'ENTER'='{ENTER}'; 'ESC'='{ESC}'; 'ESCAPE'='{ESC}'; 'TAB'='{TAB}'; 'BACKSPACE'='{BACKSPACE}';
        'SPACE'=' '; 'LEFT'='{LEFT}'; 'RIGHT'='{RIGHT}'; 'UP'='{UP}'; 'DOWN'='{DOWN}';
        'HOME'='{HOME}'; 'END'='{END}'; 'PGUP'='{PGUP}'; 'PAGEUP'='{PGUP}'; 'PGDN'='{PGDN}'; 'PAGEDOWN'='{PGDN}';
        'INSERT'='{INSERT}'; 'DELETE'='{DELETE}'; 'F1'='{F1}'; 'F2'='{F2}'; 'F3'='{F3}'; 'F4'='{F4}';
        'F5'='{F5}'; 'F6'='{F6}'; 'F7'='{F7}'; 'F8'='{F8}'; 'F9'='{F9}'; 'F10'='{F10}'; 'F11'='{F11}'; 'F12'='{F12}'
    }
    if ($special.ContainsKey($k)) { return $special[$k] }
    if ($k.Length -eq 1) { return $k.ToLowerInvariant() }
    throw "desktop_hotkey_key_unsupported:$k"
}

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    $payloadText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($payloadText)) { Emit-Result @{status='failed';action='hotkey';error='desktop_payload_missing'} 1 }
    $payload = $payloadText | ConvertFrom-Json
    $keys = @($payload.keys)
    if ($keys.Count -lt 2 -or $keys.Count -gt 6) { Emit-Result @{status='failed';action='hotkey';error='desktop_hotkey_invalid'} 1 }

    $seq = ''
    $bodyStarted = $false
    foreach ($raw in $keys) {
        $k = ([string]$raw).Trim().ToUpperInvariant()
        switch ($k) {
            'CTRL' { $seq += '^'; continue }
            'CONTROL' { $seq += '^'; continue }
            'ALT' { $seq += '%'; continue }
            'MENU' { $seq += '%'; continue }
            'SHIFT' { $seq += '+'; continue }
            'WIN' { throw 'desktop_hotkey_win_unsupported' }
            'LWIN' { throw 'desktop_hotkey_win_unsupported' }
            'RWIN' { throw 'desktop_hotkey_win_unsupported' }
            default { $seq += (KeyToSendKeys $k); $bodyStarted = $true }
        }
    }
    if (-not $bodyStarted) { throw 'desktop_hotkey_body_required' }

    [System.Windows.Forms.SendKeys]::SendWait($seq)
    Start-Sleep -Milliseconds 50
    Emit-Result @{status='succeeded';action='hotkey';keys=@($keys | ForEach-Object { ([string]$_).ToUpperInvariant() });method='sendkeys';sequence=$seq}
} catch {
    Emit-Result @{status='failed';action='hotkey';error=[string]$_.Exception.Message} 1
}
