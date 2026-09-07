# ARIA Evaluation Engine 2.0

## Purpose
The Evaluation Engine is the certification boundary for new or changed capabilities. A capability is not considered certified until every required stage passes.

## Required certification stages
1. `unit`
2. `integration`
3. `security`
4. `behavior`
5. `regression`
6. `live`

The certification API is fail-closed: a missing stage runner, failed stage, or unexecuted required stage prevents certification.

## Internal benchmark
The engine supports deterministic benchmark cases with stable IDs and an expected-result predicate. Benchmark results are hashed and can be compared against a baseline. A previously passing case becoming non-passing is a regression.

## Longitudinal evaluation
A capability can be evaluated over a rolling window of up to 100 missions. The longitudinal gate requires 100 observed mission records for a full-strength 100-mission certification window. Fewer observations remain insufficient evidence.

## Reliability metrics
Per capability, the engine records:
- success rate
- verification rate
- recovery rate
- regression rate
- average attempts
- failure modes
- mission count
- composite reliability score

Unknown data remains unknown; zero is never substituted for missing evidence.

## Reliability score
The current bounded composite score weights:
- success: 35%
- verification: 25%
- recovery: 15%
- regression avoidance: 15%
- attempt efficiency: 10%

The score is informational and evidence-backed; it does not bypass stage gates.

## Self-Model integration
Evaluation evidence can be injected into the ARIA Self-Model, exposing `reliability_by_capability` and the evaluation-engine authority flag without granting execution permissions.

## Security invariants
The evaluation layer must not store credentials or secrets. Certification records may contain evidence and hashes but never raw credential material. Human gates are never simulated.

## Evidence rule
A longitudinal 100-mission certification performed by the harness proves the evaluation mechanism over a 100-record window. It must not be described as evidence from 100 real production missions unless those real historical records are independently available and verified.
