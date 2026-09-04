# ARIA Device Execution Contract — AF-3

**Version:** `aria-device-execution-v1`
**Purpose:** generic protocol between ARIA and a remote execution agent (Termux first; Windows/Linux/server agents later).

## Flow

`Mission → Execution Job → authorized device → command → stdout/stderr/exit code → mission state`

The device is an executor, not a planner. ARIA owns mission intent, tool selection, governance, retries and completion verification.

## Job

```json
{
  "job_id": "job_…",
  "mission_id": "mission_…",
  "device_id": "device_…",
  "operation": "shell.execute",
  "command": "npm test",
  "cwd": "/workspace/project",
  "timeout_ms": 120000,
  "environment": {},
  "policy": { "risk_class": "LOW_RISK_WRITE" }
}
```

No plaintext secrets are carried in jobs. Secret references belong to ARIA's credential boundary and must be resolved only where policy permits.

## Result

```json
{
  "job_id": "job_…",
  "status": "succeeded | failed | timeout | cancelled",
  "exit_code": 0,
  "stdout": "…",
  "stderr": "…",
  "duration_ms": 1234,
  "metadata": { "agent_version": "…", "platform": "android-termux" }
}
```

## Device authentication

Each device uses a dedicated bearer token provisioned out-of-band. The server stores only a cryptographic hash of the token. A device token is never written to mission state, job payloads or logs.

## Safety invariants

- Every job is bound to exactly one device and mission.
- Claiming a job is atomic; a job cannot be simultaneously claimed by two devices.
- A device can submit results only for jobs assigned to itself.
- The gateway rejects missing/invalid credentials and unknown devices.
- The agent executes only commands delivered by the authorized gateway.
- Human-Gate decisions remain authoritative for dangerous operations.
- stdout/stderr are bounded and sanitized before persistence/telemetry.
- Terminal/device execution is transport-specific; the mission/execution contracts remain transport-neutral.
