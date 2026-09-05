# ARIA canonical Supabase runtime

These directories are the version-controlled source for the production ARIA control loop:

- `supabase/functions/aria-planner-v9`
- `supabase/functions/aria-autonomy-supervisor-v10`
- `supabase/functions/aria-mission-runner-v15`

Production deployment is intentionally gated by GitHub Actions secrets. Pull requests validate that the canonical sources exist; only pushes to `main` may deploy them.

Required GitHub Actions secrets for production deployment:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

No runtime credentials belong in this repository.