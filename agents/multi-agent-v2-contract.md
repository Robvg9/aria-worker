# Multi-Agent 2.0 Contract

## Purpose
Turn the existing governed 8-agent catalog into an internal cognitive society with explicit management and arbitration.

## Required flow
`goal -> capability/role matching -> agent selection -> task graph -> sequential/parallel execution -> stop/limit checks -> result verification -> consensus/disagreement arbitration -> final decision -> learning/telemetry`

## Manager guarantees
- selects only registered, available agents;
- respects `maxAgents`, `maxParallel`, budget and max steps;
- deterministic ranking for equivalent inputs;
- supports sequential and bounded parallel execution;
- stops on verified success, budget exhaustion, failure, max steps, or Human Gate requirement;
- never grants execution authority; executors are injected behind the existing execution boundary.

## Arbitration guarantees
- preserves every agent result;
- distinguishes consensus, majority and disagreement;
- disagreement never becomes silent consensus;
- optional consensus requirement fail-closes to `needs_review`;
- external AI providers are not required for Multi-Agent 2.0.

## Safety invariants
- secrets remain outside agent payloads and executors;
- high-risk operations continue through existing governance/Human Gates;
- no agent may elevate another agent's permissions;
- depth, concurrency and cost are bounded.
