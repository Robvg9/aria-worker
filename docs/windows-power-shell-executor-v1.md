# Windows PowerShell Autonomous Executor v1

ARIA's Windows Local Agent supports two governed device operations:

- `ollama.qwen3`
- `shell.execute`

A `shell.execute` job may use either a raw PowerShell command in `job.command` or a JSON payload:

```json
{"script":"Get-Location","cwd":"D:\\ARIA-Windows-Agent","timeout_ms":120000,"dry_run":false}
```

The agent returns `status`, `exit_code`, `stdout`, `stderr`, `duration_ms`, and execution metadata. `dry_run=true` validates the command and returns `planned` without running it.

Destructive system-management patterns are blocked locally by policy. Output is bounded to prevent unbounded memory growth, and the existing gateway/device authentication remains unchanged.
