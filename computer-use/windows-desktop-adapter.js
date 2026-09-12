'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

const VERSION = 'aria-windows-desktop-v1';
const MAX_TEXT = 32 * 1024;
const MAX_SCREENSHOT_B64 = 8 * 1024 * 1024;
const ACTIONS = new Set(['screenshot', 'observe', 'open', 'click', 'type', 'keypress', 'scroll', 'focus']);

const POWERSHELL = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Json($x) { $x | ConvertTo-Json -Compress -Depth 12 }

function Invoke-Desktop($payload) {
  $action = [string]$payload.action
  switch ($action) {
    'screenshot' {
      $screens = [System.Windows.Forms.Screen]::AllScreens
      $left = ($screens.Bounds.Left | Measure-Object -Minimum).Minimum
      $top = ($screens.Bounds.Top | Measure-Object -Minimum).Minimum
      $right = ($screens.Bounds.Right | Measure-Object -Maximum).Maximum
      $bottom = ($screens.Bounds.Bottom | Measure-Object -Maximum).Maximum
      $width = $right - $left
      $height = $bottom - $top
      $bmp = New-Object System.Drawing.Bitmap $width,$height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.CopyFromScreen($left,$top,0,0,$bmp.Size)
        $ms = New-Object System.IO.MemoryStream
        try {
          $bmp.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png)
          $b64 = [Convert]::ToBase64String($ms.ToArray())
        } finally { $ms.Dispose() }
      } finally { $g.Dispose(); $bmp.Dispose() }
      return @{status='succeeded'; action='screenshot'; screenshot_base64=$b64; width=$width; height=$height; bounds=@{left=$left;top=$top;right=$right;bottom=$bottom}}
    }
    'open' {
      $path = [string]$payload.path
      if ([string]::IsNullOrWhiteSpace($path)) { throw 'desktop_open_path_required' }
      $p = Start-Process -FilePath $path -PassThru
      return @{status='succeeded'; action='open'; pid=$p.Id; path=$path}
    }
    'focus' {
      $name = [string]$payload.process
      if ([string]::IsNullOrWhiteSpace($name)) { throw 'desktop_focus_process_required' }
      $proc = Get-Process -Name $name -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if (-not $proc) { throw 'desktop_focus_window_not_found' }
      Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AriaWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
'@
      [AriaWindow]::ShowWindowAsync($proc.MainWindowHandle,9) | Out-Null
      [AriaWindow]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
      return @{status='succeeded'; action='focus'; process=$name; pid=$proc.Id}
    }
    'click' {
      if ($null -eq $payload.x -or $null -eq $payload.y) { throw 'desktop_click_coordinates_required' }
      Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AriaMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra);
  public const uint LEFTDOWN=0x0002, LEFTUP=0x0004, RIGHTDOWN=0x0008, RIGHTUP=0x0010;
}
'@
      $x=[int]$payload.x; $y=[int]$payload.y; $button=[string]($payload.button ?? 'left')
      [AriaMouse]::SetCursorPos($x,$y) | Out-Null
      if ($button -eq 'right') { [AriaMouse]::mouse_event([AriaMouse]::RIGHTDOWN,0,0,0,[UIntPtr]::Zero); [AriaMouse]::mouse_event([AriaMouse]::RIGHTUP,0,0,0,[UIntPtr]::Zero) }
      else { [AriaMouse]::mouse_event([AriaMouse]::LEFTDOWN,0,0,0,[UIntPtr]::Zero); [AriaMouse]::mouse_event([AriaMouse]::LEFTUP,0,0,0,[UIntPtr]::Zero) }
      return @{status='succeeded'; action='click'; x=$x; y=$y; button=$button}
    }
    'type' {
      $text=[string]$payload.text
      if ([string]::IsNullOrEmpty($text)) { throw 'desktop_type_text_required' }
      if ($text.Length -gt 32768) { throw 'desktop_type_text_too_large' }
      Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AriaKeyboard {
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public UIntPtr dwExtraInfo; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
  public const uint INPUT_KEYBOARD=1, KEYEVENTF_UNICODE=0x0004, KEYEVENTF_KEYUP=0x0002;
}
'@
      $inputs = New-Object 'AriaKeyboard+INPUT[]' ($text.Length * 2)
      $i=0
      foreach ($ch in $text.ToCharArray()) {
        $inputs[$i].type=[AriaKeyboard]::INPUT_KEYBOARD; $inputs[$i].U.ki=[AriaKeyboard]::KEYBDINPUT::new(); $inputs[$i].U.ki.wScan=[int][char]$ch; $inputs[$i].U.ki.dwFlags=[AriaKeyboard]::KEYEVENTF_UNICODE; $i++
        $inputs[$i].type=[AriaKeyboard]::INPUT_KEYBOARD; $inputs[$i].U.ki=[AriaKeyboard]::KEYBDINPUT::new(); $inputs[$i].U.ki.wScan=[int][char]$ch; $inputs[$i].U.ki.dwFlags=[AriaKeyboard]::KEYEVENTF_UNICODE -bor [AriaKeyboard]::KEYEVENTF_KEYUP; $i++
      }
      $sent=[AriaKeyboard]::SendInput($inputs.Length,$inputs,[Runtime.InteropServices.Marshal]::SizeOf([AriaKeyboard]::INPUT))
      if ($sent -ne $inputs.Length) { throw "desktop_type_sendinput_failed:$sent/$($inputs.Length)" }
      return @{status='succeeded'; action='type'; characters=$text.Length}
    }
    'keypress' {
      $key=[string]$payload.key
      $map=@{ENTER=0x0D;ESC=0x1B;TAB=0x09;SPACE=0x20;BACKSPACE=0x08;DELETE=0x2E;HOME=0x24;END=0x23;LEFT=0x25;UP=0x26;RIGHT=0x27;DOWN=0x28;F1=0x70;F2=0x71;F3=0x72;F4=0x73;F5=0x74;F6=0x75;F7=0x76;F8=0x77;F9=0x78;F10=0x79;F11=0x7A;F12=0x7B}
      if ($key.Length -eq 1) { $vk=[int][char]$key.ToUpperInvariant() }
      elseif ($map.ContainsKey($key.ToUpperInvariant())) { $vk=$map[$key.ToUpperInvariant()] }
      else { throw 'desktop_key_unsupported' }
      Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AriaKey { [DllImport("user32.dll")] public static extern void keybd_event(byte bVk,byte bScan,uint dwFlags,UIntPtr dwExtraInfo); public const uint KEYUP=0x0002; }
'@
      [AriaKey]::keybd_event([byte]$vk,0,0,[UIntPtr]::Zero); [AriaKey]::keybd_event([byte]$vk,0,[AriaKey]::KEYUP,[UIntPtr]::Zero)
      return @{status='succeeded'; action='keypress'; key=$key}
    }
    'scroll' {
      $delta=[int]($payload.delta ?? 0)
      if ($delta -eq 0) { throw 'desktop_scroll_delta_required' }
      Add-Type @'
using System; using System.Runtime.InteropServices; public static class AriaScroll { [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); public const uint WHEEL=0x0800; }
'@
      [AriaScroll]::mouse_event([AriaScroll]::WHEEL,0,0,[uint32]$delta,[UIntPtr]::Zero)
      return @{status='succeeded'; action='scroll'; delta=$delta}
    }
    'observe' {
      $shell = New-Object -ComObject WScript.Shell
      $activeTitle = $shell.AppActivate($shell.CurrentDirectory) | Out-Null
      $processes = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 80 ProcessName,Id,MainWindowTitle
      return @{status='succeeded'; action='observe'; metadata=@{windows=@($processes | ForEach-Object { @{process=$_.ProcessName;pid=$_.Id;title=$_.MainWindowTitle} })}}
    }
    default { throw "desktop_action_unsupported:$action" }
  }
}

Invoke-Desktop $payload | Json
`;

function validateRequest(request = {}) {
  if (!request || typeof request !== 'object') throw new Error('desktop_request_invalid');
  const action = String(request.action || '');
  if (!ACTIONS.has(action)) throw new Error('desktop_action_unsupported');
  if (action === 'type' && (typeof request.text !== 'string' || request.text.length === 0 || request.text.length > MAX_TEXT)) throw new Error('desktop_type_invalid');
  if (action === 'open' && (typeof request.path !== 'string' || !request.path.trim())) throw new Error('desktop_open_invalid');
  if (action === 'focus' && (typeof request.process !== 'string' || !request.process.trim())) throw new Error('desktop_focus_invalid');
  if (action === 'click' && (!Number.isInteger(request.x) || !Number.isInteger(request.y))) throw new Error('desktop_click_invalid');
  if (action === 'keypress' && (typeof request.key !== 'string' || !request.key.trim())) throw new Error('desktop_keypress_invalid');
  if (action === 'scroll' && !Number.isInteger(request.delta)) throw new Error('desktop_scroll_invalid');
  return Object.freeze({ ...request, action });
}

function executeWindowsDesktop(request, { timeout_ms = 30_000 } = {}) {
  const payload = validateRequest(request);
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command', POWERSHELL], {
      windowsHide: true, stdio: ['pipe','pipe','pipe']
    });
    let stdout=''; let stderr=''; let settled=false;
    const finish=(value)=>{ if(settled)return; settled=true; clearTimeout(timer); resolve(value); };
    const timer=setTimeout(()=>{ try{child.kill()}catch(_){} finish({status:'timeout',action:payload.action,error:'desktop_timeout'}); }, Math.max(1000,timeout_ms));
    child.stdout.on('data', c => { stdout += c.toString('utf8'); if(stdout.length>MAX_SCREENSHOT_B64+100000) child.kill(); });
    child.stderr.on('data', c => { stderr += c.toString('utf8').slice(0,8192); });
    child.on('error', e => finish({status:'failed',action:payload.action,error:String(e.message||e)}));
    child.on('close', code => {
      if (code !== 0) return finish({status:'failed',action:payload.action,exit_code:code,error:stderr||`powershell_exit_${code}`});
      try {
        const result=JSON.parse(stdout.trim());
        if(result.screenshot_base64 && result.screenshot_base64.length>MAX_SCREENSHOT_B64) return finish({status:'failed',action:payload.action,error:'desktop_screenshot_too_large'});
        finish({...result,version:VERSION});
      } catch (e) { finish({status:'failed',action:payload.action,error:`desktop_invalid_result:${e.message}`,stdout:stdout.slice(-4096)}); }
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

module.exports = Object.freeze({ VERSION, ACTIONS, validateRequest, executeWindowsDesktop });
