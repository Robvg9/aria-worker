# Mission 11.2 — Tool Router Contract

## Purpose

Define the deterministic Control Plane boundary that selects which registered tool operation(s) are appropriate for a task before Governance authorization and Gateway dispatch.

## Position in the chain

`Tool Registry (10.9) → Tool Router (11.2) → Governance (10.12) → Tool/MCP Gateway (11.1) → Execution`

Selection is not authorization and authorization is not execution.

## Responsibilities

- Accept a normalized task intent and requested capability/tool intent.
- Resolve candidates only from the Tool Registry.
- Filter candidates by declared availability, operation support, capability fit, and policy constraints supplied as input.
- Produce a deterministic ordered selection plan.
- Support multi-tool chaining as a plan of independently governed steps.
- Preserve the requested operation and scope; never broaden them silently.
- Return `no_route` when evidence is insufficient or no valid registered candidate exists.

## Non-responsibilities

The Tool Router does not:

- invent tools or operations;
- authorize execution or bypass Governance;
- resolve credentials or secrets;
- dispatch tools;
- mutate registries;
- alter quota/capacity state;
- perform retries or fallback execution;
- write canonical memory;
- claim a tool is live merely because it is registered.

## Input

```json
{
  "task_id": "string",
  "request_id": "string",
  "intent": "string",
  "required_capability": "string|null",
  "preferred_tool_id": "string|null",
  "preferred_operation": "string|null",
  "steps": []
}
```

## Output

```json
{
  "status": "route|no_route",
  "task_id": "string",
  "request_id": "string",
  "plan": [
    {
      "tool_id": "string",
      "operation": "string",
      "risk_class": "READ|LOW_RISK_WRITE|HIGH_RISK_WRITE|DESTRUCTIVE",
      "selection_reason": "string"
    }
  ]
}
```

## Deterministic selection policy

1. Validate required request identity.
2. Consider only tools declared by the Tool Registry.
3. Require tool status `available`.
4. Require an exact operation match when an operation is requested.
5. Require declared capability compatibility when a capability is requested.
6. Prefer explicit tool/operation preferences only when the candidate remains valid.
7. Stable lexical ordering by `tool_id`, then `operation`.
8. Return `no_route` rather than inventing or guessing a candidate.

## Multi-tool chaining

A plan may contain multiple steps. Each step remains an independently identifiable tool/operation selection and must later pass Governance and Gateway validation. The Router never turns one approval into blanket authorization for unrelated steps.

## Safety invariants

- Registered ≠ available ≠ selected ≠ authorized ≠ executed.
- Unknown tools and operations fail closed.
- Missing evidence never becomes availability.
- Selection cannot authorize execution.
- The Router cannot resolve or expose secrets.
- The Router cannot bypass risk controls, quota, capacity, fallback, or Human Gate.
- The Router cannot mutate canonical memory.
- Material changes to tool, operation, scope, or risk require a new downstream authorization decision.

## V1 scope

Design-controlled deterministic routing only. No live tool execution, no credential access, and no autonomous approval.
