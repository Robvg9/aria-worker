# ARIA canonical Supabase runtime

Canonical production control-loop source is versioned under `supabase/functions/aria-planner-v9`, `supabase/functions/aria-autonomy-supervisor-v10`, and `supabase/functions/aria-mission-runner-v15`.

Pull requests validate sources. Only `main` pushes may deploy. Production deployment requires GitHub Actions secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`. No runtime credentials belong in Git.