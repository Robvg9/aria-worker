# ARIA Evidence-Driven Self-Improvement v1

## Purpose
A self-improvement claim is not confirmed by model text. It becomes `VERIFIED` only when the intended change, executable verification, regression result, and durable evidence are all present.

## Lifecycle
`VISION -> OBJECTIVE -> GOAL -> MISSION -> HYPOTHESIS -> IMPLEMENT -> TEST -> VERIFY -> EVIDENCE -> LEARN -> DOCUMENT -> NEXT`

## Outcome semantics
- `VERIFIED`: acceptance criteria passed with reproducible evidence.
- `FAILED`: attempted execution completed but acceptance criteria did not pass.
- `BLOCKED`: an explicit capability, authorization, or physical/external gate prevented a valid attempt.
- `QUEUED`: not yet attempted.
- `IN_PROGRESS`: currently executing.

## Minimum evidence package
Every self-improvement mission should preserve:
1. objective/goal/mission identifiers;
2. original acceptance criteria and verifier;
3. hypothesis and intended change;
4. concrete changed artifacts and revision identifiers when available;
5. test commands/results or equivalent runtime observations;
6. regression result;
7. final classification (`VERIFIED`, `FAILED`, or `BLOCKED`);
8. timestamps and an evidence hash over the canonical evidence payload;
9. learned lesson and whether it is reusable.

## Anti-self-certification rule
ARIA-generated prose is evidence of what ARIA reported, not proof that the claim is true. `CONFIRMED` requires machine-verifiable evidence from repository, runtime, database, device, or another explicitly trusted verifier.

## Documentation rule
The system must preserve a per-objective history. Multiple attempts are append-only evidence records linked to the same objective. Failed and blocked attempts remain visible; they are never rewritten as success.

## Regression rule
A change is not a verified improvement merely because a target test passes. Existing required behavior must also remain healthy according to the applicable regression suite.

## Human gate rule
A blocked mission is not a global meditation failure. The mission is parked with a concrete gate description; eligible autonomous objectives continue.
