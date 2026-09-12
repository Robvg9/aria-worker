'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const VERSION = 'aria-windows-desktop-v1.6';
const MAX_TEXT = 32 * 1024;
const MAX_SCREENSHOT_B64 = 8 * 1024 * 1024;
const ACTIONS = new Set(['screenshot', 'observe', 'open', 'click', 'type', 'keypress', 'scroll', 'focus']);
const UIA_SCRIPT = path.join(__dirname, 'windows-ui-automation.ps1');

// PowerShell script is built WITHOUT JS template interpolation for PS variables.
// Use string concatenation so `$` and `${` stay as PowerShell syntax.
const POWERSHELL =
  "$ErrorActionPreference = 'Stop'\n" +
  "$ProgressPreference = 'SilentlyContinue'\n" +
  "\n" +
  "function Emit-Error($code, $detail) {\n" +
  "  $msg = if ($null -eq $detail) { [string]$code } else { \"$code|$detail\" }\n" +
  "  $err = @{ status = 'failed'; action = 'screenshot'; error = $msg }\n" +
  "  $err | ConvertTo-Json -Compress -Depth 6\n" +
  "  exit 1\n" +
  "}\n" +
  "\n" +
  "try {\n" +
  "  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop\n" +
  "  Add-Type -AssemblyName System.Drawing -ErrorAction Stop\n" +
  "} catch {\n" +
  "  Emit-Error 'desktop_assembly_load_failed' $_.Exception.Message\n" +
  "}\n" +
  "\n" +
  "$ariaCaptureSource = @'\n" +
  "using System;\n" +
  "using System.Runtime.InteropServices;\n" +
  "public static class AriaCapture {\n" +
  "  [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();\n" +
  "  [DllImport(\"user32.dll\")] public static extern IntPtr GetDC(IntPtr hWnd);\n" +
  "  [DllImport(\"user32.dll\")] public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);\n" +
  "  [DllImport(\"gdi32.dll\")] public static extern IntPtr CreateCompatibleDC(IntPtr hdc);\n" +
  "  [DllImport(\"gdi32.dll\")] public static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);\n" +
  "  [DllImport(\"gdi32.dll\")] public static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);\n" +
  "  [DllImport(\"gdi32.dll\")] public static extern bool BitBlt(IntPtr hdcDest, int nXDest, int nYDest, int nWidth, int nHeight, IntPtr hdcSrc, int nXSrc, int nYSrc, int dwRop);\n" +
  "  [DllImport(\"gdi32.dll\")] public static extern bool DeleteObject(IntPtr hObject);\n" +
  "  [DllImport(\"gdi32.dll\")] public static extern bool DeleteDC(IntPtr hdc);\n" +
  "  public const int SRCCOPY = 0x00CC0020;\n" +
  "}\n" +
  "'@\n" +
  "try {\n" +
  "  if (-not ([System.Management.Automation.PSTypeName]'AriaCapture').Type) {\n" +
  "    Add-Type -TypeDefinition $ariaCaptureSource -ErrorAction Stop\n" +
  "  }\n" +
  "} catch {\n" +
  "  if ($_.Exception.Message -notmatch 'already exists|duplicate') {\n" +
  "    Emit-Error 'desktop_pinvoke_load_failed' $_.Exception.Message\n" +
  "  }\n" +
  "}\n" +
  "\n" +
  "try { [AriaCapture]::SetProcessDPIAware() | Out-Null } catch {}\n" +
  "\n" +
  "$payloadJson = [Console]::In.ReadToEnd()\n" +
  "if ([string]::IsNullOrWhiteSpace($payloadJson)) { Emit-Error 'desktop_payload_missing' $null }\n" +
  "try { $payload = $payloadJson | ConvertFrom-Json } catch { Emit-Error 'desktop_payload_invalid_json' $_.Exception.Message }\n" +
  "\n" +
  "function Json($x) { $x | ConvertTo-Json -Compress -Depth 12 }\n" +
  "\n" +
  "function Capture-ScreenshotPngBase64 {\n" +
  "  $screen = [System.Windows.Forms.Screen]::PrimaryScreen\n" +
  "  if ($null -eq $screen) { throw 'desktop_primary_screen_missing' }\n" +
  "  $b = $screen.Bounds\n" +
  "  $left = [int]$b.Left\n" +
  "  $top = [int]$b.Top\n" +
  "  $width = [int]$b.Width\n" +
  "  $height = [int]$b.Height\n" +
  "  if ($width -le 0 -or $height -le 0) {\n" +
  "    $vb = [System.Windows.Forms.SystemInformation]::VirtualScreen\n" +
  "    $left = [int]$vb.Left\n" +
  "    $top = [int]$vb.Top\n" +
  "    $width = [int]$vb.Width\n" +
  "    $height = [int]$vb.Height\n" +
  "  }\n" +
  "  if ($width -le 0 -or $height -le 0) {\n" +
  "    throw (\"desktop_invalid_screen_bounds:$left,$top,${width}x${height}\" -f $left,$top,$width,$height)\n" +
  "  }\n" +
  "  if ($width -gt 16384 -or $height -gt 16384) {\n" +
  "    throw \"desktop_screen_too_large:${width}x${height}\"\n" +
  "  }\n" +
  "  $method = 'bitblt'\n" +
  "  $b64 = $null\n" +
  "  $bitbltError = $null\n" +
  "  try {\n" +
  "    $hdcSrc = [AriaCapture]::GetDC([IntPtr]::Zero)\n" +
  "    if ($hdcSrc -eq [IntPtr]::Zero) { throw 'desktop_getdc_failed' }\n" +
  "    $hdcDest = [IntPtr]::Zero\n" +
  "    $hBmp = [IntPtr]::Zero\n" +
  "    $hOld = [IntPtr]::Zero\n" +
  "    try {\n" +
  "      $hdcDest = [AriaCapture]::CreateCompatibleDC($hdcSrc)\n" +
  "      if ($hdcDest -eq [IntPtr]::Zero) { throw 'desktop_create_compatible_dc_failed' }\n" +
  "      $hBmp = [AriaCapture]::CreateCompatibleBitmap($hdcSrc, $width, $height)\n" +
  "      if ($hBmp -eq [IntPtr]::Zero) { throw 'desktop_create_compatible_bitmap_failed' }\n" +
  "      $hOld = [AriaCapture]::SelectObject($hdcDest, $hBmp)\n" +
  "      $ok = [AriaCapture]::BitBlt($hdcDest, 0, 0, $width, $height, $hdcSrc, $left, $top, [AriaCapture]::SRCCOPY)\n" +
  "      if (-not $ok) { throw 'desktop_bitblt_failed' }\n" +
  "      $bmp = [System.Drawing.Image]::FromHbitmap($hBmp)\n" +
  "      try {\n" +
  "        $ms = New-Object System.IO.MemoryStream\n" +
  "        try {\n" +
  "          $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)\n" +
  "          $b64 = [Convert]::ToBase64String($ms.ToArray())\n" +
  "        } finally { $ms.Dispose() }\n" +
  "      } finally { $bmp.Dispose() }\n" +
  "    } finally {\n" +
  "      if ($hOld -ne [IntPtr]::Zero) { [AriaCapture]::SelectObject($hdcDest, $hOld) | Out-Null }\n" +
  "      if ($hBmp -ne [IntPtr]::Zero) { [AriaCapture]::DeleteObject($hBmp) | Out-Null }\n" +
  "      if ($hdcDest -ne [IntPtr]::Zero) { [AriaCapture]::DeleteDC($hdcDest) | Out-Null }\n" +
  "      if ($hdcSrc -ne [IntPtr]::Zero) { [AriaCapture]::ReleaseDC([IntPtr]::Zero, $hdcSrc) | Out-Null }\n" +
  "    }\n" +
  "  } catch {\n" +
  "    $bitbltError = \"$($_.Exception.GetType().FullName): $($_.Exception.Message)\"\n" +
  "    $b64 = $null\n" +
  "  }\n" +
  "  if ([string]::IsNullOrEmpty($b64)) {\n" +
  "    $method = 'copyfromscreen'\n" +
  "    try {\n" +
  "      $bmp2 = New-Object System.Drawing.Bitmap ([int]$width), ([int]$height)\n" +
  "      $g = [System.Drawing.Graphics]::FromImage($bmp2)\n" +
  "      try {\n" +
  "        $size = New-Object System.Drawing.Size ([int]$width), ([int]$height)\n" +
  "        $g.CopyFromScreen([int]$left, [int]$top, 0, 0, $size)\n" +
  "        $ms2 = New-Object System.IO.MemoryStream\n" +
  "        try {\n" +
  "          $bmp2.Save($ms2, [System.Drawing.Imaging.ImageFormat]::Png)\n" +
  "          $b64 = [Convert]::ToBase64String($ms2.ToArray())\n" +
  "        } finally { $ms2.Dispose() }\n" +
  "      } finally { $g.Dispose(); $bmp2.Dispose() }\n" +
  "    } catch {\n" +
  "      $copyError = \"$($_.Exception.GetType().FullName): $($_.Exception.Message)\"\n" +
  "      $detail = \"bitblt=$bitbltError; copyfromscreen=$copyError; bounds=$left,$top,${width}x${height}; apt=$([System.Threading.Thread]::CurrentThread.GetApartmentState())\"\n" +
  "      throw \"desktop_screenshot_failed:$detail\"\n" +
  "    }\n" +
  "  }\n" +
  "  if ([string]::IsNullOrEmpty($b64)) { throw \"desktop_screenshot_empty:bitblt=$bitbltError\" }\n" +
  "  return @{ status='succeeded'; action='screenshot'; screenshot_base64=$b64; width=$width; height=$height; capture_method=$method; bounds=@{left=$left;top=$top;right=($left+$width);bottom=($top+$height)}; apartment=[string][System.Threading.Thread]::CurrentThread.GetApartmentState() }\n" +
  "}\n" +
  "\n" +
  "function Invoke-Desktop($p) {\n" +
  "  $action = [string]$p.action\n" +
  "  switch ($action) {\n" +
  "    'screenshot' { return Capture-ScreenshotPngBase64 }\n" +
  "    'open' {\n" +
  "      $path = [string]$p.path\n" +
  "      if ([string]::IsNullOrWhiteSpace($path)) { throw 'desktop_open_path_required' }\n" +
  "      $proc = Start-Process -FilePath $path -PassThru\n" +
  "      return @{status='succeeded';action='open';pid=$proc.Id;path=$path}\n" +
  "    }\n" +
  "    'focus' {\n" +
  "      $name = [string]$p.process\n" +
  "      if ([string]::IsNullOrWhiteSpace($name)) { throw 'desktop_focus_process_required' }\n" +
  "      $proc = Get-Process -Name $name -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1\n" +
  "      if (-not $proc) { throw 'desktop_focus_window_not_found' }\n" +
  "      Add-Type @'\n" +
  "using System; using System.Runtime.InteropServices;\n" +
  "public static class AriaWindow { [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd,int nCmdShow); }\n" +
  "'@\n" +
  "      [AriaWindow]::ShowWindowAsync($proc.MainWindowHandle,9) | Out-Null\n" +
  "      [AriaWindow]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null\n" +
  "      return @{status='succeeded';action='focus';process=$name;pid=$proc.Id}\n" +
  "    }\n" +
  "    'click' {\n" +
  "      if ($null -eq $p.x -or $null -eq $p.y) { throw 'desktop_click_coordinates_required' }\n" +
  "      $x=[int]$p.x; $y=[int]$p.y; $button='left'\n" +
  "      if ($null -ne $p.button -and -not [string]::IsNullOrWhiteSpace([string]$p.button)) { $button=[string]$p.button }\n" +
  "      Add-Type @'\n" +
  "using System; using System.Runtime.InteropServices;\n" +
  "public static class AriaMouse { [DllImport(\"user32.dll\")] public static extern bool SetCursorPos(int X,int Y); [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); public const uint LD=0x0002,LU=0x0004,RD=0x0008,RU=0x0010; }\n" +
  "'@\n" +
  "      [AriaMouse]::SetCursorPos($x,$y) | Out-Null\n" +
  "      if ($button -eq 'right') { [AriaMouse]::mouse_event([AriaMouse]::RD,0,0,0,[UIntPtr]::Zero); [AriaMouse]::mouse_event([AriaMouse]::RU,0,0,0,[UIntPtr]::Zero) }\n" +
  "      else { [AriaMouse]::mouse_event([AriaMouse]::LD,0,0,0,[UIntPtr]::Zero); [AriaMouse]::mouse_event([AriaMouse]::LU,0,0,0,[UIntPtr]::Zero) }\n" +
  "      return @{status='succeeded';action='click';x=$x;y=$y;button=$button}\n" +
  "    }\n" +
  "    'type' {\n" +
  "      $text=[string]$p.text\n" +
  "      if ([string]::IsNullOrEmpty($text)) { throw 'desktop_type_text_required' }\n" +
  "      if ($text.Length -gt 32768) { throw 'desktop_type_text_too_large' }\n" +
  "      Add-Type @'\n" +
  "using System; using System.Runtime.InteropServices;\n" +
  "public static class AriaKeyboard { [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; } [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; } [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; } [DllImport(\"user32.dll\",SetLastError=true)] public static extern uint SendInput(uint nInputs,INPUT[] pInputs,int cbSize); public const uint IK=1,UNICODE=0x0004,KEYUP=0x0002; }\n" +
  "'@\n" +
  "      $inputs=New-Object 'AriaKeyboard+INPUT[]' ($text.Length*2); $i=0\n" +
  "      foreach($ch in $text.ToCharArray()){\n" +
  "        $inputs[$i].type=[AriaKeyboard]::IK; $inputs[$i].U.ki=New-Object AriaKeyboard+KEYBDINPUT; $inputs[$i].U.ki.wScan=[int][char]$ch; $inputs[$i].U.ki.dwFlags=[AriaKeyboard]::UNICODE; $i++\n" +
  "        $inputs[$i].type=[AriaKeyboard]::IK; $inputs[$i].U.ki=New-Object AriaKeyboard+KEYBDINPUT; $inputs[$i].U.ki.wScan=[int][char]$ch; $inputs[$i].U.ki.dwFlags=[AriaKeyboard]::UNICODE -bor [AriaKeyboard]::KEYUP; $i++\n" +
  "      }\n" +
  "      $sent=[AriaKeyboard]::SendInput($inputs.Length,$inputs,[Runtime.InteropServices.Marshal]::SizeOf([type][AriaKeyboard+INPUT])); if($sent -ne $inputs.Length){throw \"desktop_type_sendinput_failed:$sent/$($inputs.Length)\"}\n" +
  "      return @{status='succeeded';action='type';characters=$text.Length}\n" +
  "    }\n" +
  "    'keypress' {\n" +
  "      $key=[string]$p.key; $map=@{ENTER=0x0D;ESC=0x1B;TAB=0x09;SPACE=0x20;BACKSPACE=0x08;DELETE=0x2E;HOME=0x24;END=0x23;LEFT=0x25;UP=0x26;RIGHT=0x27;DOWN=0x28;F1=0x70;F2=0x71;F3=0x72;F4=0x73;F5=0x74;F6=0x75;F7=0x76;F8=0x77;F9=0x78;F10=0x79;F11=0x7A;F12=0x7B}\n" +
  "      if($key.Length -eq 1){$vk=[int][char]$key.ToUpperInvariant()} elseif($map.ContainsKey($key.ToUpperInvariant())){$vk=$map[$key.ToUpperInvariant()]} else{throw 'desktop_key_unsupported'}\n" +
  "      Add-Type @'\n" +
  "using System; using System.Runtime.InteropServices; public static class AriaKey { [DllImport(\"user32.dll\")] public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo); public const uint KEYUP=0x0002; }\n" +
  "'@\n" +
  "      [AriaKey]::keybd_event([byte]$vk,0,0,[UIntPtr]::Zero); [AriaKey]::keybd_event([byte]$vk,0,[AriaKey]::KEYUP,[UIntPtr]::Zero); return @{status='succeeded';action='keypress';key=$key}\n" +
  "    }\n" +
  "    'scroll' {\n" +
  "      $delta=0; if ($null -ne $p.delta) { $delta=[int]$p.delta }; if($delta -eq 0){throw 'desktop_scroll_delta_required'}\n" +
  "      Add-Type @'\n" +
  "using System; using System.Runtime.InteropServices; public static class AriaScroll { [DllImport(\"user32.dll\")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); public const uint WHEEL=0x0800; }\n" +
  "'@\n" +
  "      [AriaScroll]::mouse_event([AriaScroll]::WHEEL,0,0,[uint32]$delta,[UIntPtr]::Zero); return @{status='succeeded';action='scroll';delta=$delta}\n" +
  "    }\n" +
  "    default { throw \"desktop_action_requires_native_observer:$action\" }\n" +
  "  }\n" +
  "}\n" +
  "\n" +
  "try { Invoke-Desktop $payload | Json } catch {\n" +
  "  $detail = \"$($_.Exception.GetType().FullName): $($_.Exception.Message)\"\n" +
  "  @{ status = 'failed'; action = [string]$payload.action; error = $detail } | ConvertTo-Json -Compress -Depth 6\n" +
  "  exit 1\n" +
  "}\n";

function validateRequest(request = {}) {
  if (!request || typeof request !== 'object') throw new Error('desktop_request_invalid');
  const action = String(request.action || ''); if (!ACTIONS.has(action)) throw new Error('desktop_action_unsupported');
  if (action === 'type' && (typeof request.text !== 'string' || request.text.length === 0 || request.text.length > MAX_TEXT)) throw new Error('desktop_type_invalid');
  if (action === 'open' && (typeof request.path !== 'string' || !request.path.trim())) throw new Error('desktop_open_invalid');
  if (action === 'focus' && (typeof request.process !== 'string' || !request.process.trim())) throw new Error('desktop_focus_invalid');
  if (action === 'click' && (!Number.isInteger(request.x) || !Number.isInteger(request.y))) throw new Error('desktop_click_invalid');
  if (action === 'keypress' && (typeof request.key !== 'string' || !request.key.trim())) throw new Error('desktop_keypress_invalid');
  if (action === 'scroll' && !Number.isInteger(request.delta)) throw new Error('desktop_scroll_invalid');
  return Object.freeze({ ...request, action });
}

function spawnProcess(args, payload, timeout_ms) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => {
      try { child.kill(); } catch (_) {}
      finish({ status: 'timeout', action: payload.action, error: 'desktop_timeout' });
    }, Math.max(1000, timeout_ms));
    child.stdout.on('data', (c) => {
      stdout += c.toString('utf8');
      if (stdout.length > MAX_SCREENSHOT_B64 + 100000) child.kill();
    });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8').slice(0, 8192); });
    child.on('error', (e) => finish({ status: 'failed', action: payload.action, error: String(e.message || e) }));
    child.on('close', (code) => {
      const trimmed = stdout.trim();
      if (trimmed) {
        try {
          const result = JSON.parse(trimmed);
          if (result.screenshot_base64 && result.screenshot_base64.length > MAX_SCREENSHOT_B64) {
            return finish({ status: 'failed', action: payload.action, error: 'desktop_screenshot_too_large' });
          }
          if (result.status === 'failed' || code !== 0) {
            return finish({
              status: 'failed',
              action: payload.action || result.action,
              exit_code: code,
              error: result.error || stderr || ('powershell_exit_' + code),
              version: VERSION,
            });
          }
          return finish(Object.assign({}, result, { version: VERSION }));
        } catch (_) {}
      }
      if (code !== 0) {
        return finish({
          status: 'failed',
          action: payload.action,
          exit_code: code,
          error: stderr || ('powershell_exit_' + code),
          stdout: trimmed.slice(-4096),
        });
      }
      finish({
        status: 'failed',
        action: payload.action,
        error: 'desktop_invalid_result:empty_or_unparseable',
        stdout: trimmed.slice(-4096),
        stderr,
      });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

function executeWindowsDesktop(request, { timeout_ms = 30_000 } = {}) {
  const payload = validateRequest(request);
  const baseArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass'];
  if (payload.action === 'observe') {
    return spawnProcess(baseArgs.concat(['-File', UIA_SCRIPT]), payload, timeout_ms);
  }
  return spawnProcess(baseArgs.concat(['-Command', POWERSHELL]), payload, timeout_ms);
}

module.exports = Object.freeze({ VERSION, ACTIONS, validateRequest, executeWindowsDesktop });
