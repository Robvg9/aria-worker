# ARIA Block C — Stage 11 Runtime Contract

## Pipeline

`Tool Registry (10.9) → Tool Router (11.2) → Operation Planner/Normalizer (11.3) → Governance (10.12) → Tool/MCP Gateway (11.1) → Tool Adapter Boundary (11.4) → external tool`

### 11.1 Gateway
The Gateway accepts only a normalized request and an already-approved governance decision. It validates exact request/execution/tool/operation/risk binding, applies required human verification, and dispatches only through an injected adapter.

The Gateway never creates network clients, resolves secrets, authorizes requests, changes routes, retries, falls back, changes quota/capacity, or writes memory.

### 11.2 Tool Router
Router selection is deterministic and registry-backed. Selection never implies authorization. Multi-tool plans remain independently identifiable.

### 11.3 Planner/Normalizer
Planner converts a valid router result into ordered explicit steps. It preserves task/request/tool/operation/risk/selection reason and rejects malformed, duplicated or secret-bearing plans.

### 11.4 Adapter Boundary
Adapter receives exactly the already-authorized operation scope. Protocol-specific behavior belongs to the adapter. The adapter cannot broaden tool, operation, identity or risk scope. Adapter output is normalized and sensitive output is rejected by the Gateway.

## Fail-closed invariants
- Unknown/unavailable tool → blocked.
- Unknown operation → blocked.
- Missing/mismatched authorization → blocked.
- Required high-risk/destructive verification → blocked when absent.
- Missing adapter → blocked.
- Adapter failure → normalized failed result.
- Sensitive output → blocked.
- One request cannot authorize another request, execution, tool, operation or risk class.
- No stage 11 component writes canonical memory.

## Live boundary
The repository implementation supports controlled dependency-injected dispatch. The default production posture does not create or invoke a live external adapter automatically.
