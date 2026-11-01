# ARIA PWA exact-SHA certification refresh — 2026-11-01

## Purpose

Re-publish the unchanged production application and Worker source at one exact `main` commit so the authenticated PWA Steps 7–8 certification can wait for and verify both production deploys against that same SHA.

## Scope

This is a documentation-only release-coordination marker. It does not change application code, Worker behavior, deployment workflow logic, secrets, Supabase data or credentials, Telegram delivery, `MISSION_EXECUTION_PAUSED`, or any Windows Scheduled Task.

## Why this refresh is required

The certification run `41271264056` is waiting for both exact-SHA production deployments. The preceding merge changed deployment-isolation workflows and was intentionally excluded from the automatic production deploy paths. A documentation-only commit outside those exclusions causes the standard production deployment workflows to publish the unchanged code at the new exact SHA.

## Verification required

1. Confirm the Cloudflare Worker production deployment completed for this exact SHA.
2. Confirm the PWA Fast Lane production deployment completed for this exact SHA and its versioned Service Worker is valid.
3. Run the authenticated Steps 7–8 PWA and persistence E2E against that same SHA.
4. Preserve the uploaded evidence and confirm it is persisted to Issue 1011.

The earlier waiting run `41271264056` remains historical/incomplete; it is not a PASS. Do not mark this certification complete until the new exact-SHA deployment and E2E evidence are verified.
