$ErrorActionPreference = 'Stop'

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('aria-config-replace-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
$source = Join-Path $root 'new-config.tmp'
$destination = Join-Path $root 'worker.config.json'
$backup = Join-Path $root 'worker.config.backup'

try {
    [System.IO.File]::WriteAllText($source, '{"version":"new"}', ([System.Text.UTF8Encoding]::new($false)))
    [System.IO.File]::WriteAllText($destination, '{"version":"old"}', ([System.Text.UTF8Encoding]::new($false)))

    [System.IO.File]::Replace($source, $destination, $backup)

    if ([System.IO.File]::ReadAllText($destination) -cne '{"version":"new"}') {
        throw 'Atomic replacement did not publish the new config.'
    }
    if ([System.IO.File]::ReadAllText($backup) -cne '{"version":"old"}') {
        throw 'Atomic replacement did not preserve the previous config backup.'
    }
    if (Test-Path -LiteralPath $source) {
        throw 'Atomic replacement did not consume its temporary source file.'
    }

    Write-Output 'ARIA_CONFIG_ATOMIC_REPLACE_WITH_BACKUP=PASS'
    Write-Output 'ARIA_CONFIG_PREVIOUS_VERSION_PRESERVED=PASS'
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}
