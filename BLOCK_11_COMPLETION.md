# BLOCK 11/11 — ARIA META-REASONING

Status: CERTIFIED V1 — implementation + audit/E2E evidence.
Version: 1.0.0

Missions:
- 11.1 Meta-Reasoning Contract
- 11.2 Evidence Sufficiency
- 11.3 Confidence / Uncertainty Gate
- 11.4 Failure-Strategy Detection
- 11.5 Better Skill / Agent Detection
- 11.6 Research / Investigation Decision
- 11.7 Experiment-or-Abstain Decision
- 11.8 Human Gate Detection
- 11.9 Router Meta-Reasoning Overlay

Certification evidence:
- ARIA npm test: run 34170150049 → success.
- ARIA Meta-Reasoning 1 LIVE: run 34170150020 → success.
- Meta-reasoning v1 test: success.
- Router meta-reasoning overlay v1 test: success.
- Security 2.0 LIVE, Evaluation Engine 2.0 LIVE, Device Universe v1 LIVE, Computer Use v1 LIVE, World Model 2.0 LIVE and Multimodal + Voice v1 LIVE remain green on the same certified HEAD.

Core capability:
- ARIA can explicitly determine when evidence is insufficient.
- Confidence and uncertainty are represented separately from authorization.
- Known/repeated strategy failures can trigger a strategy change instead of blind repetition.
- A better-fit skill or specialized agent can be recommended deterministically.
- Investigation/research can be required before action.
- Bounded experimentation can be recommended when it reduces uncertainty/downside.
- Explicit human approval requirements route to human_gate.
- Abstention is a first-class successful outcome when autonomous action is not justified.
- The Meta-Reasoning Router Overlay can combine metacognitive judgment with the existing economic and classic Router layers without changing their contracts.

Safety boundaries:
- Pure, deterministic and secret-free control-plane layer.
- No execution authority.
- No credential access.
- No permission grants.
- No bypass of Security 2.0.
- No replacement of Resource / Cost Intelligence.
- Human gates remain mandatory and cannot be self-approved.
- Contradictory, missing or insufficient evidence fails closed.

Continuity:
- Previous certified phases remain closed and are not reopened without demonstrated regression.
- Browser/Computer Use real transport remains under its existing Human Gate.
- External Multi-IA remains intentionally deferred to the later roadmap frontier.

Block 11 is closed for V1. Future improvements are roadmap work, not unfinished work in this certification.
