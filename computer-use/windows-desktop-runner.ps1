$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Emit-Result([hashtable]$value, [int]$exitCode = 0) {
    $value | ConvertTo-Json -Compress -Depth 12
    if ($exitCode -ne 0) { exit $exitCode }
}

function Get-ButtonFlags([string]$button) {
    switch ($button.ToLowerInvariant()) {
        'left'  { return @{ down = [AriaDesktopNative]::LEFTDOWN; up = [AriaDesktopNative]::LEFTUP } }
        'right' { return @{ down = [AriaDesktopNative]::RIGHTDOWN; up = [AriaDesktopNative]::RIGHTUP } }
        default { throw 'desktop_pointer_button_unsupported' }
    }
}

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop

    Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AriaDesktopNative {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetDC(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);
    [DllImport("gdi32.dll")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool BitBlt(IntPtr dest, int xd, int yd, int width, int height, IntPtr src, int xs, int ys, int rop);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr obj);
    [DllImport("gdi32.dll")] public static extern bool DeleteDC(IntPtr hdc);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public const uint KEYEVENTF_KEYUP = 0x0002;
    public const uint LEFTDOWN = 0x0002;
    public const uint LEFTUP = 0x0004;
    public const uint RIGHTDOWN = 0x0008;
    public const uint RIGHTUP = 0x0010;
    public const uint WHEEL = 0x0800;
    public const int SRCCOPY = 0x00CC0020;
}
"@

    $payloadText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($payloadText)) {
        Emit-Result @{ status='failed'; action='unknown'; error='desktop_payload_missing' } 1
    }

    $payload = $payloadText | ConvertFrom-Json
    $action = [string]$payload.action
    $apartment = [string][System.Threading.Thread]::CurrentThread.GetApartmentState()

    $keyMap = @{
        'ENTER'=0x0D; 'ESC'=0x1B; 'ESCAPE'=0x1B; 'TAB'=0x09; 'BACKSPACE'=0x08; 'SPACE'=0x20
        'LEFT'=0x25; 'UP'=0x26; 'RIGHT'=0x27; 'DOWN'=0x28; 'HOME'=0x24; 'END'=0x23
        'PGUP'=0x21; 'PAGEUP'=0x21; 'PGDN'=0x22; 'PAGEDOWN'=0x22; 'INSERT'=0x2D; 'DELETE'=0x2E
        'CTRL'=0x11; 'CONTROL'=0x11; 'SHIFT'=0x10; 'ALT'=0x12; 'MENU'=0x12
        'WIN'=0x5B; 'LWIN'=0x5B; 'RWIN'=0x5C; 'CAPSLOCK'=0x14; 'NUMLOCK'=0x90; 'SCROLLLOCK'=0x91
        'PRINTSCREEN'=0x2C; 'PAUSE'=0x13
        'F1'=0x70; 'F2'=0x71; 'F3'=0x72; 'F4'=0x73; 'F5'=0x74; 'F6'=0x75; 'F7'=0x76; 'F8'=0x77
        'F9'=0x78; 'F10'=0x79; 'F11'=0x7A; 'F12'=0x7B
    }
    foreach ($i in 0..25) { $keyMap[[char]([int][char]'A' + $i)] = 0x41 + $i }
    foreach ($i in 0..9) { $keyMap[[string]$i] = 0x30 + $i }

    function Resolve-Vk([string]$key) {
        $k = $key.Trim().ToUpperInvariant()
        if ($keyMap.ContainsKey($k)) { return [byte]$keyMap[$k] }
        throw "desktop_keypress_key_unsupported:$k"
    }

    function Send-Vk([string]$key) {
        $vk = Resolve-Vk $key
        [AriaDesktopNative]::keybd_event($vk,0,0,[UIntPtr]::Zero)
        [AriaDesktopNative]::keybd_event($vk,0,[AriaDesktopNative]::KEYEVENTF_KEYUP,[UIntPtr]::Zero)
    }

    function Send-VkDown([byte]$vk) {
        [AriaDesktopNative]::keybd_event($vk,0,0,[UIntPtr]::Zero)
    }

    function Send-VkUp([byte]$vk) {
        [AriaDesktopNative]::keybd_event($vk,0,[AriaDesktopNative]::KEYEVENTF_KEYUP,[UIntPtr]::Zero)
    }

    switch ($action) {
        'screenshot' {
            [AriaDesktopNative]::SetProcessDPIAware() | Out-Null
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen
            if ($null -eq $screen) { Emit-Result @{status='failed';action=$action;error='desktop_primary_screen_missing';apartment=$apartment} 1 }
            $b = $screen.Bounds
            $left=[int]$b.Left; $top=[int]$b.Top; $width=[int]$b.Width; $height=[int]$b.Height
            if ($width -le 0 -or $height -le 0) { Emit-Result @{status='failed';action=$action;error='desktop_invalid_screen_bounds';apartment=$apartment} 1 }
            $hdcSrc=[IntPtr]::Zero; $hdcDest=[IntPtr]::Zero; $hBmp=[IntPtr]::Zero; $hOld=[IntPtr]::Zero; $image=$null; $ms=$null
            try {
                $hdcSrc=[AriaDesktopNative]::GetDC([IntPtr]::Zero); if ($hdcSrc -eq [IntPtr]::Zero) { throw 'desktop_getdc_failed' }
                $hdcDest=[AriaDesktopNative]::CreateCompatibleDC($hdcSrc); if ($hdcDest -eq [IntPtr]::Zero) { throw 'desktop_create_compatible_dc_failed' }
                $hBmp=[AriaDesktopNative]::CreateCompatibleBitmap($hdcSrc,$width,$height); if ($hBmp -eq [IntPtr]::Zero) { throw 'desktop_create_compatible_bitmap_failed' }
                $hOld=[AriaDesktopNative]::SelectObject($hdcDest,$hBmp); if ($hOld -eq [IntPtr]::Zero) { throw 'desktop_select_object_failed' }
                if (-not [AriaDesktopNative]::BitBlt($hdcDest,0,0,$width,$height,$hdcSrc,$left,$top,[AriaDesktopNative]::SRCCOPY)) { throw 'desktop_bitblt_failed' }
                $image=[System.Drawing.Image]::FromHbitmap($hBmp)
                $ms=New-Object System.IO.MemoryStream
                $image.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
                Emit-Result @{status='succeeded';action=$action;screenshot_base64=[Convert]::ToBase64String($ms.ToArray());width=$width;height=$height;capture_method='bitblt';apartment=$apartment}
            } catch { Emit-Result @{status='failed';action=$action;error=$_.Exception.Message;apartment=$apartment;width=$width;height=$height} 1 }
            finally {
                if ($image) { $image.Dispose() }
                if ($ms) { $ms.Dispose() }
                if ($hOld -ne [IntPtr]::Zero -and $hdcDest -ne [IntPtr]::Zero) { [AriaDesktopNative]::SelectObject($hdcDest,$hOld) | Out-Null }
                if ($hBmp -ne [IntPtr]::Zero) { [AriaDesktopNative]::DeleteObject($hBmp) | Out-Null }
                if ($hdcDest -ne [IntPtr]::Zero) { [AriaDesktopNative]::DeleteDC($hdcDest) | Out-Null }
                if ($hdcSrc -ne [IntPtr]::Zero) { [AriaDesktopNative]::ReleaseDC([IntPtr]::Zero,$hdcSrc) | Out-Null }
            }
        }
        'open' {
            $path=[string]$payload.path
            if ([string]::IsNullOrWhiteSpace($path)) { Emit-Result @{status='failed';action=$action;error='desktop_open_path_required'} 1 }
            $proc=Start-Process -FilePath $path -PassThru
            Emit-Result @{status='succeeded';action=$action;pid=$proc.Id;path=$path}
        }
        'focus' {
            $name=[string]$payload.process
            if ([string]::IsNullOrWhiteSpace($name)) { Emit-Result @{status='failed';action=$action;error='desktop_focus_process_required'} 1 }
            $proc=Get-Process -Name $name -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
            if ($null -eq $proc) { Emit-Result @{status='failed';action=$action;error='desktop_focus_window_not_found';process=$name} 1 }
            [AriaDesktopNative]::ShowWindowAsync($proc.MainWindowHandle,9) | Out-Null
            [AriaDesktopNative]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
            Emit-Result @{status='succeeded';action=$action;process=$name;pid=$proc.Id}
        }
        'move' {
            $x=[int]$payload.x; $y=[int]$payload.y
            if (-not [AriaDesktopNative]::SetCursorPos($x,$y)) { Emit-Result @{status='failed';action=$action;error='desktop_move_failed';x=$x;y=$y} 1 }
            Emit-Result @{status='succeeded';action=$action;x=$x;y=$y}
        }
        'click' {
            $x=[int]$payload.x; $y=[int]$payload.y; $button='left'
            if ($null -ne $payload.button) { $button=[string]$payload.button }
            $flags=Get-ButtonFlags $button
            [AriaDesktopNative]::SetCursorPos($x,$y) | Out-Null
            [AriaDesktopNative]::mouse_event($flags.down,0,0,0,[UIntPtr]::Zero)
            [AriaDesktopNative]::mouse_event($flags.up,0,0,0,[UIntPtr]::Zero)
            Emit-Result @{status='succeeded';action=$action;x=$x;y=$y;button=$button.ToLowerInvariant()}
        }
        'double_click' {
            $x=[int]$payload.x; $y=[int]$payload.y; $button='left'
            if ($null -ne $payload.button) { $button=[string]$payload.button }
            $flags=Get-ButtonFlags $button
            [AriaDesktopNative]::SetCursorPos($x,$y) | Out-Null
            1..2 | ForEach-Object {
                [AriaDesktopNative]::mouse_event($flags.down,0,0,0,[UIntPtr]::Zero)
                [AriaDesktopNative]::mouse_event($flags.up,0,0,0,[UIntPtr]::Zero)
                if ($_ -eq 1) { Start-Sleep -Milliseconds 70 }
            }
            Emit-Result @{status='succeeded';action=$action;x=$x;y=$y;button=$button.ToLowerInvariant()}
        }
        'drag' {
            $x1=[int]$payload.x1; $y1=[int]$payload.y1; $x2=[int]$payload.x2; $y2=[int]$payload.y2; $button='left'
            if ($null -ne $payload.button) { $button=[string]$payload.button }
            $duration=250
            if ($null -ne $payload.duration_ms) { $duration=[int]$payload.duration_ms }
            if ($duration -lt 0 -or $duration -gt 10000) { $duration=250 }
            $flags=Get-ButtonFlags $button
            [AriaDesktopNative]::SetCursorPos($x1,$y1) | Out-Null
            [AriaDesktopNative]::mouse_event($flags.down,0,0,0,[UIntPtr]::Zero)
            Start-Sleep -Milliseconds 40
            if ($duration -eq 0) {
                [AriaDesktopNative]::SetCursorPos($x2,$y2) | Out-Null
            } else {
                $steps=[Math]::Max(1,[Math]::Min(100,[Math]::Ceiling($duration / 10)))
                for ($i=1;$i -le $steps;$i++) {
                    $px=[int][Math]::Round($x1 + (($x2-$x1) * $i / $steps))
                    $py=[int][Math]::Round($y1 + (($y2-$y1) * $i / $steps))
                    [AriaDesktopNative]::SetCursorPos($px,$py) | Out-Null
                    Start-Sleep -Milliseconds ([Math]::Max(1,[int]($duration/$steps)))
                }
            }
            [AriaDesktopNative]::mouse_event($flags.up,0,0,0,[UIntPtr]::Zero)
            Emit-Result @{status='succeeded';action=$action;x1=$x1;y1=$y1;x2=$x2;y2=$y2;button=$button.ToLowerInvariant();duration_ms=$duration}
        }
        'type' {
            $text=[string]$payload.text
            if ([string]::IsNullOrEmpty($text)) { Emit-Result @{status='failed';action=$action;error='desktop_type_text_required'} 1 }
            $oldText=$null; $hadText=$false
            try {
                if ([System.Windows.Forms.Clipboard]::ContainsText()) { $oldText=[System.Windows.Forms.Clipboard]::GetText(); $hadText=$true }
            } catch {}
            try {
                [System.Windows.Forms.Clipboard]::SetText($text)
                Start-Sleep -Milliseconds 30
                Send-VkDown 0x11
                Start-Sleep -Milliseconds 20
                Send-VkDown 0x56
                Send-VkUp 0x56
                Send-VkUp 0x11
                Start-Sleep -Milliseconds 30
            } finally {
                try {
                    if ($hadText) { [System.Windows.Forms.Clipboard]::SetText($oldText) }
                    else { [System.Windows.Forms.Clipboard]::Clear() }
                } catch {}
            }
            Emit-Result @{status='succeeded';action=$action;text_length=$text.Length;method='clipboard_paste'}
        }
        'keypress' {
            $key=[string]$payload.key
            Send-Vk $key
            Emit-Result @{status='succeeded';action=$action;key=$key.ToUpperInvariant()}
        }
        'hotkey' {
            $keys=@($payload.keys)
            if ($keys.Count -lt 2 -or $keys.Count -gt 6) { Emit-Result @{status='failed';action=$action;error='desktop_hotkey_invalid'} 1 }
            $pressed=@()
            try {
                foreach ($key in $keys) {
                    $pressed += Resolve-Vk ([string]$key)
                    Send-VkDown $pressed[$pressed.Count-1]
                    Start-Sleep -Milliseconds 15
                }
                Start-Sleep -Milliseconds 25
            } finally {
                for ($i=$pressed.Count-1;$i -ge 0;$i--) { Send-VkUp ([byte]$pressed[$i]) }
            }
            Emit-Result @{status='succeeded';action=$action;keys=@($keys)}
        }
        'scroll' {
            $delta=[int]$payload.delta
            if ($delta -eq 0) { Emit-Result @{status='failed';action=$action;error='desktop_scroll_delta_required'} 1 }
            [AriaDesktopNative]::mouse_event([AriaDesktopNative]::WHEEL,0,0,[uint32]$delta,[UIntPtr]::Zero)
            Emit-Result @{status='succeeded';action=$action;delta=$delta}
        }
        'wait' {
            $ms=[int]$payload.ms
            if ($ms -lt 0 -or $ms -gt 60000) { Emit-Result @{status='failed';action=$action;error='desktop_wait_invalid'} 1 }
            Start-Sleep -Milliseconds $ms
            Emit-Result @{status='succeeded';action=$action;ms=$ms}
        }
        default { Emit-Result @{status='failed';action=$action;error='desktop_action_not_supported_by_runner';apartment=$apartment} 1 }
    }
}
catch {
    Emit-Result @{status='failed';action='unknown';error=("{0}: {1}" -f $_.Exception.GetType().FullName,$_.Exception.Message)} 1
}
