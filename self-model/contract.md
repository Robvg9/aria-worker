# ARIA Self-Model / Autonomy Control — Phase 2

## Purpose
The Self-Model is ARIA's authoritative runtime description of what it can do, cannot do, is doing, owns, knows with confidence, is uncertain about, is learning, and has recently changed or failed at.

## Capability record
Each capability is represented with:
- capability
- status
- confidence
- last_verified
- evidence
- dependencies
- cost
- risk
- reliability
- optional source and regression_test_id

## Self-model questions
The model explicitly answers:
- Who am I?
- What can I do?
- What can't I do?
- What am I currently doing?
- What resources do I have?
- What capabilities are verified?
- What capabilities are uncertain?
- What changed recently?
- What am I learning?
- What failed recently?
- Why did it fail?

## Capability Graph
The graph turns capability records and dependencies into nodes/edges. It is a read-oriented control surface: it does not grant permissions or execute tools.

## Autonomy selection
`chooseBestCapability(capability)` first consults the injected Router boundary when available, then falls back to verified/active/available capability evidence. Unknown or uncertain capability state remains explicit; missing capabilities are never invented.

## Cross-layer bindings
The Self-Model accepts read-only/injected references for Router, Memory, Learning, Planner, and Self-Development. It records the existence of these authorities but does not duplicate their internal logic or write to them implicitly.

## Change control
- Self-Model refresh is observational.
- Capability records do not grant execution authority.
- No credentials or secret material are stored.
- Comparisons produce explicit added/removed/changed capability state.
- The model can be persisted only through an explicitly injected stateStore.
- Router remains authoritative for route selection; Self-Model consumes its result/evidence.
- Human Gates remain outside this phase's implementation and are not bypassed.
