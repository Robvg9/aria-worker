# ARIA Block C — Scope Lock

## Objective
Close the current Stage 11 Tool/MCP execution boundary as a controlled runtime path while preserving strict separation between selection, planning, authorization, gateway dispatch and protocol adapters.

## Missions covered
- **11.1 Tool/MCP Gateway:** governed dispatch boundary is executable with an injected adapter and remains fail-closed.
- **11.2 Tool Router:** deterministic tool/operation selection is preserved and regression-tested as the upstream control-plane input.
- **11.3 Tool Operation Planner/Normalizer:** route results become explicit ordered steps with scope-preserving validation.
- **11.4 Tool Adapter/Dispatch Boundary:** the gateway hands one already-authorized operation to an injected protocol adapter; no live I/O is created by the gateway itself.

## Explicit exclusions
- No autonomous approval.
- No credential resolution in Stage 11.
- No quota/capacity mutation.
- No fallback mutation.
- No canonical memory writes.
- No BattleCruiser changes.
- No Supabase schema or RLS changes.
- No uncontrolled production network calls.

## Runtime posture
Controlled runtime is enabled through dependency injection. Live external dispatch remains explicitly disabled by default and requires the caller to supply the external adapter/runtime boundary.
