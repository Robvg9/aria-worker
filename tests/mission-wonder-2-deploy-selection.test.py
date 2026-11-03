#!/usr/bin/env python3
"""Regression tests for canonical deployment discovery used by Gate 3."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from mission_wonder_2_deploy_selection import (
    collect_successful_canonical_supabase_deploys,
    is_successful_canonical_supabase_deploy,
)


class CanonicalDeploySelectionTests(unittest.TestCase):
    def setUp(self):
        # This fixture mirrors the already-successful protected deployment
        # that Gate 3 previously missed because its event was workflow_dispatch.
        self.valid_dispatch = {
            "name": "Deploy ARIA Supabase Runtime",
            "path": ".github/workflows/supabase-canonical-deploy.yml",
            "head_branch": "main",
            "event": "workflow_dispatch",
            "status": "completed",
            "conclusion": "success",
            "head_sha": "fc0940b906f08e0bf2b0ebbf7f9843db6dc18e1f",
        }

    def test_accepts_existing_successful_protected_dispatch(self):
        self.assertTrue(is_successful_canonical_supabase_deploy(self.valid_dispatch))

    def test_accepts_successful_automatic_push(self):
        run = {**self.valid_dispatch, "event": "push"}
        self.assertTrue(is_successful_canonical_supabase_deploy(run))

    def test_rejects_unconfigured_event(self):
        run = {**self.valid_dispatch, "event": "schedule"}
        self.assertFalse(is_successful_canonical_supabase_deploy(run))

    def test_rejects_wrong_workflow_path_or_name(self):
        for key, value in (
            ("path", ".github/workflows/other.yml"),
            ("name", "Unrelated workflow"),
        ):
            with self.subTest(key=key):
                run = {**self.valid_dispatch, key: value}
                self.assertFalse(is_successful_canonical_supabase_deploy(run))

    def test_rejects_wrong_branch(self):
        run = {**self.valid_dispatch, "head_branch": "feature"}
        self.assertFalse(is_successful_canonical_supabase_deploy(run))

    def test_rejects_non_success_terminal_states(self):
        for status, conclusion in (
            ("in_progress", None),
            ("completed", "failure"),
            ("completed", "cancelled"),
        ):
            with self.subTest(status=status, conclusion=conclusion):
                run = {**self.valid_dispatch, "status": status, "conclusion": conclusion}
                self.assertFalse(is_successful_canonical_supabase_deploy(run))

    def test_rejects_invalid_commit_sha(self):
        run = {**self.valid_dispatch, "head_sha": "fc0940b"}
        self.assertFalse(is_successful_canonical_supabase_deploy(run))

    def test_rejects_non_object_values(self):
        self.assertFalse(is_successful_canonical_supabase_deploy(None))
        self.assertFalse(is_successful_canonical_supabase_deploy("workflow_dispatch"))

    def test_finds_successful_deploy_on_second_page(self):
        # Reproduce the observed failure: the first full page has only failed
        # canonical attempts; the successful protected dispatch is on page 2.
        failed = {**self.valid_dispatch, "conclusion": "failure"}
        pages = {
            1: {"workflow_runs": [failed] * 100},
            2: {"workflow_runs": [self.valid_dispatch]},
        }
        requested_pages = []

        def fetch_page(page):
            requested_pages.append(page)
            return pages[page]

        deployments = collect_successful_canonical_supabase_deploys(
            fetch_page, page_size=100, max_pages=10
        )
        self.assertEqual(requested_pages, [1, 2])
        self.assertEqual(deployments, [self.valid_dispatch])

    def test_stops_after_short_final_page_when_no_success_exists(self):
        failed = {**self.valid_dispatch, "conclusion": "failure"}
        requested_pages = []

        def fetch_page(page):
            requested_pages.append(page)
            return {"workflow_runs": [failed]}

        deployments = collect_successful_canonical_supabase_deploys(fetch_page)
        self.assertEqual(requested_pages, [1])
        self.assertEqual(deployments, [])

    def test_rejects_malformed_pagination_response(self):
        with self.assertRaises(ValueError):
            collect_successful_canonical_supabase_deploys(lambda _page: {})


if __name__ == "__main__":
    unittest.main(verbosity=2)
