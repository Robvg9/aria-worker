""""Fail-closed selection of canonical Supabase runtime deployment runs."""
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


def collect_successful_canonical_supabase_deploys(fetch_page, page_size=100, max_pages=10):
    """Collect canonical deployments across the paginated workflow-run history.

    The workflow-specific GitHub API endpoint is queried by the caller. A full
    page means more history may exist, so keep paging up to GitHub's 1,000-result
    filtered-search limit. A malformed response fails closed instead of looking
    like an empty deployment history.
    """
    deployments = []
    for page in range(1, max_pages + 1):
        payload = fetch_page(page)
        if not isinstance(payload, dict):
            raise ValueError("GitHub workflow-run page is not an object")
        runs = payload.get("workflow_runs")
        if not isinstance(runs, list):
            raise ValueError("GitHub workflow-run page has no workflow_runs list")
        deployments.extend(
            run for run in runs if is_successful_canonical_supabase_deploy(run)
        )
        if len(runs) < page_size:
            break
    return deployments
