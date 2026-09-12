# Windows desktop screenshot — forensic notes

## Failure mode (ROBVG / PowerShell 5.1)

Smoke test in `agents/windows/install-v2.ps1` invokes:

```js
executeWindowsDesktop({ action: 'screenshot' })
```

which spawns `powershell.exe` with an embedded script that previously did:

```powershell
$bmp = New-Object System.Drawing.Bitmap -ArgumentList @([int]$width,[int]$height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen([int]$left,[int]$top,0,0,$bmp.Size)
```

### Root causes addressed in v1.6

1. **PS 5.1 `New-Object -ArgumentList @(a,b)` packing**  
   PowerShell can treat the array as a *single* constructor argument, producing invalid Bitmap construction / GDI+ errors.  
   Fix: `New-Object System.Drawing.Bitmap ([int]$width), ([int]$height)`.

2. **Missing STA**  
   `System.Windows.Forms` / GDI screen capture is reliable under Single-Threaded Apartment.  
   Fix: always pass `-STA` to `powershell.exe`.

3. **DPI / logical vs physical bounds**  
   Without `SetProcessDPIAware`, `Screen.Bounds` can disagree with the framebuffer.  
   Fix: call `SetProcessDPIAware` before reading bounds.

4. **Single capture API**  
   `Graphics.CopyFromScreen` alone fails with "The handle is invalid" when the interactive desktop DC is awkward.  
   Fix: primary path is **Win32 BitBlt** (`GetDC(0)` → compatible bitmap → `BitBlt` → `Image.FromHbitmap`), with CopyFromScreen as fallback.

5. **Opaque errors**  
   Failures now emit structured JSON with exception type, message, both method errors, bounds, and apartment state.

## Environmental hard requirement

Screenshot requires an **interactive desktop session** for the user running the agent (LogonType InteractiveToken).  
Session 0 / disconnected RDP / pure remoting without an active desktop still cannot capture pixels — that is a Windows limitation, not an ARIA bug. The agent task is registered with `InteractiveToken` for this reason.

## Validation on ROBVG

```powershell
cd C:\path\to\aria-worker   # source checkout of aria/desktop-autonomy-v1
powershell -NoProfile -ExecutionPolicy Bypass -File .\agents\windows\install-v2.ps1
```

Expect:

```
=== DESKTOP ACCESS SMOKE TEST ===
DESKTOP_SCREENSHOT=PASS width=... height=...
```

and `D:\ARIA-Windows-Agent\Logs\desktop-smoke.json` with `"status": "PASS"`.

Manual probe:

```powershell
node -e "const {executeWindowsDesktop}=require('./computer-use/windows-desktop-adapter'); executeWindowsDesktop({action:'screenshot'}).then(r=>console.log(JSON.stringify({status:r.status,w:r.width,h:r.height,m:r.capture_method,err:r.error,v:r.version}))).catch(e=>{console.error(e);process.exit(1)})"
```
