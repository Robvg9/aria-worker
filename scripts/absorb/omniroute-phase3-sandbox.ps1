[CmdletBinding()]
param(
    [switch]$Run,
    [switch]$Cleanup
)

$ErrorActionPreference = 'Stop'

$SandboxRoot = 'D:\ARIA-Windows-Agent\Sandbox\OmniRoute-v3.8.52'
$ExtractRoot = Join-Path $SandboxRoot '_extract'
$SourceDir = Join-Path $SandboxRoot 'source'
$DataDir = Join-Path $SandboxRoot 'data'
$CacheDir = Join-Path $SandboxRoot 'npm-cache'
$CapturePath = Join-Path $SandboxRoot 'PHASE3_CAPTURE.json'

$Repo = 'diegosouzapw/OmniRoute'
$Ref = 'release/v3.8.52'
$Commit = '3e66ff2e8cc94821b093fe57dad667b585230cd1'
$ArchiveUrl = "https://github.com/$Repo/archive/$Commit.zip"
$ArchivePath = Join-Path $SandboxRoot "omniroute-$Commit.zip"

$NodePath = 'D:\Databank\node.exe'
$NpmPath = 'D:\Databank\npm.cmd'

function Fail([string]$Message) {
    throw "[PHASE3-BLOCKED] $Message"
}

function Ensure-Dir([string]$Path) {
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

Write-Host '=== OMNIROUTE PHASE 3 — WINDOWS SANDBOX ==='
Write-Host "SOURCE=$Repo@$Ref"
Write-Host "COMMIT=$Commit"
Write-Host "SANDBOX=$SandboxRoot"
Write-Host "LOOPBACK=http://127.0.0.1:20128"

if (-not $Run) {
    Write-Host 'MODE=PLAN_ONLY'
    Write-Host 'Use -Run only on an authorized Windows device.'
    exit 0
}

Ensure-Dir $SandboxRoot
Ensure-Dir $DataDir
Ensure-Dir $CacheDir

if (-not (Test-Path $NodePath)) { Fail "Node.js executable not found: $NodePath" }
if (-not (Test-Path $NpmPath)) { Fail "npm.cmd executable not found: $NpmPath" }
if (-not (Get-Command curl.exe -ErrorAction SilentlyContinue)) { Fail 'curl.exe is required.' }

$NodeVersion = (& $NodePath --version 2>&1 | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $NodeVersion -notmatch '^v(?<major>\d+)\.(?<minor>\d+)\.') {
    Fail "Unable to determine Node.js version: $NodeVersion"
}
$Major = [int]$Matches.major
$Minor = [int]$Matches.minor
$NodeSupported = ($Major -eq 22 -and $Minor -ge 22) -or ($Major -ge 24 -and $Major -lt 27)
if (-not $NodeSupported) {
    Fail "Unsupported Node.js version $NodeVersion. Expected >=22.22.2 <23 or >=24.0.0 <27."
}

Remove-Item -Recurse -Force $ExtractRoot, $SourceDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $ExtractRoot, $SourceDir -Force | Out-Null

$env:NPM_CONFIG_CACHE = $CacheDir
$env:DATA_DIR = $DataDir
$env:PORT = '20128'
$env:DASHBOARD_PORT = '20128'
$env:API_PORT = '20128'
$env:HOST = '127.0.0.1'
$env:HOSTNAME = '127.0.0.1'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$env:API_KEY_SECRET = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')).Substring(0,64)
$env:INITIAL_PASSWORD = [guid]::NewGuid().ToString('N')

Write-Host "NODE=$NodeVersion"
Write-Host 'DOWNLOADING_LOCKED_SOURCE=1'
& curl.exe --fail --location --retry 2 --connect-timeout 10 --max-time 180 $ArchiveUrl -o $ArchivePath
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $ArchivePath)) {
    Fail "Locked source download failed: $ArchiveUrl"
}

$ArchiveHash = (Get-FileHash -Algorithm SHA256 -Path $ArchivePath).Hash.ToLowerInvariant()
Write-Host "ARCHIVE_SHA256=$ArchiveHash"

Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot -Force
$Extracted = Get-ChildItem -LiteralPath $ExtractRoot -Directory | Select-Object -First 1
if (-not $Extracted) { Fail 'Archive extraction produced no source directory.' }

Copy-Item -Path (Join-Path $Extracted.FullName '*') -Destination $SourceDir -Recurse -Force

if (-not (Test-Path (Join-Path $SourceDir 'package-lock.json')) -or -not (Test-Path (Join-Path $SourceDir 'package.json'))) {
    Fail 'Locked source tree is missing package.json/package-lock.json.'
}

Push-Location $SourceDir
try {
    Write-Host 'NPM_CI=1'
    & $NpmPath ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Fail "npm ci failed with exit code $LASTEXITCODE." }

    Write-Host 'BUILD=1'
    & $NpmPath run build
    if ($LASTEXITCODE -ne 0) { Fail "npm run build failed with exit code $LASTEXITCODE." }

    Write-Host 'START=1'
    $Server = Start-Process -FilePath $NodePath -ArgumentList 'scripts/dev/run-next.mjs','start' -WorkingDirectory $SourceDir -PassThru -WindowStyle Hidden

    $Healthy = $false
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Seconds 2
        try {
            $Probe = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:20128/api/health' -TimeoutSec 5
            if ($Probe.StatusCode -eq 200) {
                $Healthy = $true
                break
            }
        } catch {
        }
    }

    if (-not $Healthy) {
        if ($Server -and -not $Server.HasExited) {
            & taskkill.exe /PID $Server.Id /T /F | Out-Null
        }
        Fail 'OmniRoute did not reach /api/health = 200.'
    }

    Write-Host 'HEALTH=PASS'
    Write-Host 'STOP=1'
    & taskkill.exe /PID $Server.Id /T /F | Out-Null
    Start-Sleep -Seconds 2

    if (Get-Process -Id $Server.Id -ErrorAction SilentlyContinue) {
        Fail "OmniRoute process tree did not stop cleanly (PID $($Server.Id))."
    }

    $Capture = [ordered]@{
        schema = 'aria.absorb.omniroute.phase3.capture.v1'
        status = 'PASS_SANDBOX_EXECUTION'
        repository = $Repo
        ref = $Ref
        commit_sha = $Commit
        archive_sha256 = $ArchiveHash
        node_version = $NodeVersion
        sandbox_root = $SandboxRoot
        source_dir = $SourceDir
        data_dir = $DataDir
        npm_cache = $CacheDir
        bind_host = '127.0.0.1'
        port = 20128
        health_url = 'http://127.0.0.1:20128/api/health'
        health_status = 200
        stop_status = 'PASS'
        arias_canonical_runtime_touched = $false
        captured_at_utc = (Get-Date).ToUniversalTime().ToString('o')
    }
    $Capture | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $CapturePath

    if ($Cleanup) {
        Remove-Item -Recurse -Force $SourceDir, $ExtractRoot -ErrorAction SilentlyContinue
        Write-Host 'CLEANUP=PASS'
    }

    Write-Host 'PHASE3_SANDBOX_EXECUTION=PASS'
    Write-Host "CAPTURE=$CapturePath"
}
finally {
    if ($Server -and -not $Server.HasExited) {
        & taskkill.exe /PID $Server.Id /T /F | Out-Null
    }
    Pop-Location
}
