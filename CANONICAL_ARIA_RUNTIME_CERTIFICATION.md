# CANONICAL ARIA RUNTIME — FINAL CERTIFICATION

Date: 2026-09-05

## Canonical authority

The supported autonomous composition boundary is `canonical-runtime-v1`.

`goal -> planner -> normalized plan -> orchestrator -> executor selection -> governance -> dispatch -> execution -> verification -> checkpoint -> learning`

No new component may become a second mission, memory or provider authority.

## Certified capabilities

- Scheduler autonomy: LIVE certified in Phase 1.
- Universal multi-executor execution: LIVE certified across Device/Termux, Supabase, GitHub and Cloudflare.
- Recovery: leases, stale recovery, retries, dead-letter and waiting executor states are LIVE certified.
- Checkpoint/resume and idempotency: LIVE certified.
- Cognitive Memory: canonical `aria_memory` store with provenance, confidence, salience and relations.
- Automatic episodic capture from mission outcomes.
- Reflection Engine: mission outcome -> lesson -> `derived_from` relation.
- Skill Compiler: repeated successful lessons -> procedural skill promotion.
- Confidence Engine: evidence-based confidence updates.
- World Model: entities/events/relations updated from mission outcomes.
- Adaptive replanning: observe -> replan -> continue, bounded and governed.
- Self-Development: capability gap -> development mission with design/test/security/CI/deploy/evaluation stages.
- Multi-IA Cognitive Fabric: provider/model selection through existing canonical registries, capability and availability checks.
- Direct ARIA Interface v1: authenticated goal submission into canonical mission intake; no alternate planner, executor, memory writer or mission state machine.

## Non-regression gates

1. `npm test` must remain green.
2. Cloudflare Worker deploy must remain green.
3. Supabase canonical runtime deploy must remain green.
4. Existing Phase 1 LIVE certification remains valid.
5. Secrets never appear in plans, memory, logs or interface responses.
6. RLS remains enabled on sensitive internal tables; no client access is granted by the cognitive-memory layer.
7. Legacy runtime remains compatibility-only while new integrations enter through canonical runtime.

## Final gate

The runtime is eligible for 100% closure only when CI, deployment and the direct-interface GET smoke are green and no required Human Gate remains.
