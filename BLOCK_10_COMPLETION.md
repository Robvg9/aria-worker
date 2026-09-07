# BLOCK 10 — ARIA RESOURCE / COST INTELLIGENCE

Status: CERTIFIED V1 — implementation + regression/LIVE evidence.
Version: 1.0.0

Missions:
- 10.1 Economic Decision Contract
- 10.2 Complexity & Token Estimation
- 10.3 Cost / Latency / Compute Modeling
- 10.4 Risk & Expected-Value Gating
- 10.5 Budget / Capacity Constraints
- 10.6 Economic Router Overlay
- 10.7 Deterministic Selection & Evidence
- 10.8 Regression + LIVE Certification

Certification evidence:
- Resource Intelligence LIVE run `34169531565` on certified code path → success.
- ARIA npm test run `34169531614` on certified code path → success.
- Economic overlay preserves the classic Router contract and adds a separate governed selection layer.
- Deterministic tests cover sufficiently-good selection, budget exclusion, risk exclusion, invalid inputs, explicit unknown compute, router compatibility and no-resource outcomes.

Core behavior:
- Task complexity is estimated deterministically.
- Token demand is estimated or accepted from explicit hints.
- Candidate models expose cost, latency, optional compute, quality and risk evidence.
- Hard budgets and risk ceilings are enforced before selection.
- Selection optimizes a governed utility rather than blindly choosing the cheapest model.
- Expected value and evidence are returned with the decision.
- Unknown dimensions remain explicit and never become fabricated zero values.
- Equal candidates use deterministic tie-breaking.

Safety boundaries:
- No provider calls, inference, network access or secret access.
- Resource Intelligence does not execute actions or grant permissions.
- Downstream execution/governance remains authoritative.
- Security 2.0 remains an independent authorization boundary.

Continuity:
- Browser/Computer Use real transport remains behind its existing Human Gate.
- External Multi-IA remains deliberately deferred until the end of the roadmap.
- Do not reopen Block 10 unless a regression is demonstrated.
