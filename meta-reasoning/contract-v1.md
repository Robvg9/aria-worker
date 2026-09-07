# ARIA Meta-Reasoning Contract v1

## Objective
Provide a deterministic, secret-free metacognitive gate that decides whether ARIA should proceed, investigate, change strategy, use a better skill, delegate, experiment, request human approval, or abstain.

## Required questions
- Am I sufficiently confident?
- Is the evidence sufficient for the requested action?
- Has the current strategy already failed or repeated a known failure pattern?
- Is a better matched skill available?
- Is investigation/research required before acting?
- Is another agent better positioned?
- Is an experiment safer than direct execution?
- Is an explicit human gate required?

## Decision principles
1. Unknown evidence is not treated as positive evidence.
2. High-risk or irreversible actions require a higher evidence threshold.
3. Repeated failure penalizes repeating the same strategy.
4. Ambiguity blocks autonomous action when material to correctness or safety.
5. A human gate is mandatory for explicit approval requirements and cannot be bypassed.
6. Meta-reasoning never executes tools, models, agents, experiments, or approvals; it only recommends a next control-plane action.
7. Existing Security 2.0 remains the authorization authority.
8. Existing Resource / Cost Intelligence remains the economic authority.
9. A prior failure may be used as evidence; it is not proof that every future attempt will fail.
10. Abstention is a valid successful outcome when evidence is insufficient or risk is not justified.

## Decision states
- `proceed`
- `investigate`
- `replan`
- `use_better_skill`
- `delegate`
- `experiment`
- `human_gate`
- `abstain`

## Output boundary
Outputs include confidence, evidence sufficiency, failure-pattern assessment, recommended next action, rationale, stop conditions, and uncertainty. No credentials, execution payloads, or approval grants are produced.
