# ARIA shared remote-service circuit breaker

The Windows and Termux agents share a local persistent state file at
`~/.aria/state/remote-service-circuit.json` by default. Set
`ARIA_AGENT_STATE_DIR` to override the directory when both agents need
to share a different writable location.

## Behavior

- HTTP 402 opens a persistent gateway-wide circuit. The error body is classified as
  `quota_exhausted`, `billing_restriction`, `service_restriction`, or `unknown_402`. The full body and credentials are not persisted.
- HTTP 423 with `mission_execution_paused` pauses only the affected claim route. It does not stop local health checks or heartbeat files.
- HTTP 408, 429 and 5xx remain transient. Retry counts remain bounded; `Retry-After` is honored.
- State corruption or persistence failure fails closed: the agent does not send another gateway request.
- The first incident writes one sanitized local incident event. Repeated responses and process restarts do not emit another alert for the same stored incident.

## Recovery — operator-only

There is no timer, health poll, automatic reset, or provider fallback.

After the owner verifies that the gateway and quota are restored, and (for a paused claim route) that the canonical execution freeze has been cleared, an operator may call
`resetAfterAuthorizedRecovery({ authorized: true, probe })`.
The function invokes the supplied probe exactly once. It clears state only when the probe
returns `{ serviceRestored: true, canonicalFreezeCleared: true }` (the second
field is required whenever paused routes exist). The current mission does not call this
method and does not remove `MISSION_EXECUTION_PAUSED=true`.

This module protects the Windows and Termux clients using the same writable user state
directory. It cannot stop independent clients that do not share that directory; those
clients require their own integration.
