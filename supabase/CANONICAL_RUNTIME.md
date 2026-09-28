# ARIA canonical Supabase runtime

The production control loop has one release-bearing execution chain. Every protected canonical function must have its deployable source versioned under `supabase/functions/<function>/`; live-only source is not considered reproducible.

- `aria-planner-v11`
- `aria-canonical-runtime-v1`
- `aria-mission-runner-v22`
- `aria-runtime-gateway-v1`
- `aria-execution-runtime-v1`
- `aria-device-gateway`
- `aria-smart-verifier-v1`

The machine-readable authority is `runtime/canonical-registry.json`; the consumer and rollback boundary is documented in `runtime/consumer-rollback-matrix.md`.
Legacy planner/runner/supervisor slots are compatibility-only and are no longer deployed by the canonical workflow. Existing live legacy versions require a separate consumer audit before deactivation.

Production deployment is gated by GitHub Actions secrets. Only pushes to `main` may deploy the release-bearing chain.

Required GitHub Actions secrets for production deployment:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

No runtime credentials belong in this repository.
