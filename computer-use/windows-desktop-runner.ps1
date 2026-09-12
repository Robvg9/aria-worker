$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Emit-Result([hashtable]$value, [int]$exitCode = 0) {
    $value | ConvertTo-Json -Compress -Depth 12
    if ($exitCode -ne 0) { exit $exitCode }
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
    public const int SRCCOPY = 0x00CC0020;
    public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004, RIGHTDOWN = 0x0008, RIGHTUP = 0x0010;
    public const uint WHEEL = 0x0800;
}
"@

    $payloadText = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($payloadText)) {
        Emit-Result @{ status='failed'; error='desktop_payload_missing' } 1
    }

    $payload = $payloadText | ConvertFrom-Json
    $action = [string]$payload.action
    $apartment = [string][System.Threading.Thread]::CurrentThread.GetApartmentState()

    switch ($action) {
        'screenshot' {
            [AriaDesktopNative]::SetProcessDPIAware() | Out-Null
            $screen = [System.Windows.Forms.Screen]::PrimaryScreen
            if ($null -eq $screen) { Emit-Result @{status='failed';action=$action;error='desktop_primary_screen_missing';apartment=$apartment} 1 }

            $b = $screen.Bounds
            $left = [int]$b.Left
            $top = [int]$b.Top
            $width = [int]$b.Width
            $height = [int]$b.Height
            if ($width -le 0 -or $height -le 0) { Emit-Result @{status='failed';action=$action;error='desktop_invalid_screen_bounds';apartment=$apartment} 1 }

            $hdcSrc = [IntPtr]::Zero
            $hdcDest = [IntPtr]::Zero
            $hBmp = [IntPtr]::Zero
            $hOld = [IntPtr]::Zero
            $image = $null
            $ms = $null
            try {
                $hdcSrc = [AriaDesktopNative]::GetDC([IntPtr]::Zero)
                if ($hdcSrc -eq [IntPtr]::Zero) { throw 'desktop_getdc_failed' }
                $hdcDest = [AriaDesktopNative]::CreateCompatibleDC($hdcSrc)
                if ($hdcDest -eq [IntPtr]::Zero) { throw 'desktop_create_compatible_dc_failed' }
                $hBmp = [AriaDesktopNative]::CreateCompatibleBitmap($hdcSrc,$width,$height)
                if ($hBmp -eq [IntPtr]::Zero) { throw 'desktop_create_compatible_bitmap_failed' }
                $hOld = [AriaDesktopNative]::SelectObject($hdcDest,$hBmp)
                if ($hOld -eq [IntPtr]::Zero) { throw 'desktop_select_object_failed' }
                $ok = [AriaDesktopNative]::BitBlt($hdcDest,0,0,$width,$height,$hdcSrc,$left,$top,[AriaDesktopNative]::SRCCOPY)
                if (-not $ok) { throw 'desktop_bitblt_failed' }
                $image = [System.Drawing.Image]::FromHbitmap($hBmp)
                $ms = New-Object System.IO.MemoryStream
                $image.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
                $b64 = [Convert]::ToBase64String($ms.ToArray())
                Emit-Result @{status='succeeded';action='screenshot';screenshot_base64=$b64;width=$width;height=$height;capture_method='bitblt';apartment=$apartment}
            }
            catch {
                Emit-Result @{status='failed';action='screenshot';error=$_.Exception.Message;apartment=$apartment;width=$width;height=$height} 1
            }
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
            $path = [string]$payload.path
            if ([string]::IsNullOrWhiteSpace($path)) { Emit-Result @{status='failed';action=$action;error='desktop_open_path_required'} 1 }
            $proc = Start-Process -FilePath $path -PassThru
            Emit-Result @{status='succeeded';action=$action;pid=$proc.Id;path=$path}
        }
        'focus' {
            $name = [string]$payload.process
            $proc = Get-Process -Name $name -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
            if (-not $proc) { Emit-Result @{status='failed';action=$action;error='desktop_focus_window_not_found'} 1 }
            [AriaDesktopNative]::ShowWindowAsync($proc.MainWindowHandle,9) | Out-Null
            [AriaDesktopNative]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
            Emit-Result @{status='succeeded';action=$action;process=$name;pid=$proc.Id}
        }
        'click' {
            $x=[int]$payload.x; $y=[int]$payload.y; $button='left'
            if ($null -ne $payload.button -and -not [string]::IsNullOrWhiteSpace([string]$payload.button)) { $button=[string]$payload.button }
            [AriaDesktopNative]::SetCursorPos($x,$y) | Out-Null
            if ($button -eq 'right') {
                [AriaDesktopNative]::mouse_event([AriaDesktopNative]::RIGHTDOWN,0,0,0,[UIntPtr]::Zero)
                [AriaDesktopNative]::mouse_event([AriaDesktopNative]::RIGHTUP,0,0,0,[UIntPtr]::Zero)
            } else {
                [AriaDesktopNative]::mouse_event([AriaDesktopNative]::LEFTDOWN,0,0,0,[UIntPtr]::Zero)
                [AriaDesktopNative]::mouse_event([AriaDesktopNative]::LEFTUP,0,0,0,[UIntPtr]::Zero)
            }
            Emit-Result @{status='succeeded';action=$action;x=$x;y=$y;button=$button}
        }
        'scroll' {
            $delta=[int]$payload.delta
            if ($delta -eq 0) { Emit-Result @{status='failed';action=$action;error='desktop_scroll_delta_required'} 1 }
            [AriaDesktopNative]::mouse_event([AriaDesktopNative]::WHEEL,0,0,[uint32]$delta,[UIntPtr]::Zero)
            Emit-Result @{status='succeeded';action=$action;delta=$delta}
        }
        default {
            Emit-Result @{status='failed';action=$action;error='desktop_action_not_supported_by_runner'} 1
        }
    }
}
catch {
    Emit-Result @{status='failed';action='unknown';error=("{0}: {1}" -f $_.Exception.GetType().FullName,$_.Exception.Message)} 1
}
