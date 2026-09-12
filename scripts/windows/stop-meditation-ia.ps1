$ErrorActionPreference='Stop'
try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:45873/stop' -TimeoutSec 5 | ConvertTo-Json -Depth 10 } catch { Write-Error $_.Exception.Message }
