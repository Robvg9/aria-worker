"""Fail-closed selection of canonical Supabase runtime deployment runs."""
import re

CANONICAL_DEPLOY_NAME = "Deploy ARIA Supabase Runtime"
CANONICAL_DEPLOY_PATH = ".github/workflows/supabase-canonical-deploy.yml"
CANONICAL_DEPLOY_EVENTS = frozenset({"push", "workflow_dispatch"})


def is_successful_canonical_supabase_deploy(run):
    """Accept only completed successful runs of the canonical workflow on main."""
    if not isinstance(run, dict):
        return False
    return (
        run.get("name") == CANONICAL_DEPLOY_NAME
        and run.get("path") == CANONICAL_DEPLOY_PATH
        and run.get("head_branch") == "main"
        and run.get("event") in CANONICAL_DEPLOY_EVENTS
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and re.fullmatch(r"[0-9a-f]{40}", str(run.get("head_sha", ""))) is not None
    )
