# ARIA Proactive Consistency Auditor v1

Read-only audit layer for persisted Proactive digests and trends.

Checks:
- persisted trend counters equal recomputed row states;
- every trend-referenced digest exists in the source window;
- occurrence counts equal referenced digest-id counts.

Status is `consistent` when no mismatch exists, otherwise `drift`.

The auditor never mutates missions, jobs, routing, devices, provider state, permissions, or queues.
