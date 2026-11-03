#!/usr/bin/env python3
"""Regression tests for canonical deployment discovery used by Gate 3."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from mission_wonder_2_deploy_selection import is_successful_canonical_supabase_deploy


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
