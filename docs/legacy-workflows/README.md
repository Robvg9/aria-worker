# Legacy ARIA deployment workflows

These workflows historically patched or deployed aria-planner-v11 directly.
Phase 3 makes .github/workflows/supabase-canonical-deploy.yml the sole release-bearing deployment authority for the canonical runtime chain.
The original workflow files remain here for audit/history and are intentionally outside .github/workflows/, so GitHub Actions cannot execute them as workflows.
