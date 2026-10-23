-- ARIA queue-health diagnostics (read-only)
-- Run the statements separately against the connected ARIA Supabase project.
-- These reports expose counts, timestamps, IDs and lane classifications only.

-- 1) Counts by mission state, age and lease condition.
SELECT
  status,
  count(*)::int AS mission_rows,
  count(*) FILTER (WHERE updated_at < now() - interval '24 hours')::int AS unchanged_24h,
  count(*) FILTER (WHERE updated_at < now() - interval '72 hours')::int AS unchanged_72h,
  count(*) FILTER (WHERE lease_until IS NOT NULL AND lease_until <= now())::int AS expired_lease,
  count(*) FILTER (WHERE lease_until IS NOT NULL AND lease_until > now())::int AS live_lease,
  count(*) FILTER (WHERE lease_until IS NULL) ::int AS no_lease_deadline,
  count(*) FILTER (WHERE nullif(metadata->>'goal_id', '') IS NULL)::int AS no_goal_id
FROM aria_internal.mission_state
GROUP BY status
ORDER BY mission_rows DESC, status;

-- 2) Oldest potentially open missions, with lane and recovery metadata.
-- Does not output checkpoint contents, prompts, commands, stdout or stderr.
SELECT
  mission_id,
  status,
  coalesce(nullif(metadata->>'execution_lane',''),
           nullif(metadata->>'goal_source',''),
           'unclassified') AS lane,
  nullif(metadata->>'goal_id','') IS NOT NULL AS has_goal_id,
  created_at,
  updated_at,
  lease_owner IS NOT NULL AS has_lease_owner,
  lease_until,
  coalesce(recovery_count, 0) AS recovery_count,
  last_recovery_reason,
  coalesce(next_action, '') AS next_action
FROM aria_internal.mission_state
WHERE status IN ('queued','planning','running','waiting','paused')
ORDER BY updated_at ASC, mission_id
LIMIT 100;

-- 3) Potentially open missions reconciled to active/terminal execution jobs.
WITH jobs_by_mission AS (
  SELECT
    mission_id,
    count(*)::int AS job_rows,
    count(*) FILTER (
      WHERE status IN ('queued','claimed','running') AND completed_at IS NULL
    )::int AS active_job_rows,
    count(*) FILTER (
      WHERE status IN ('succeeded','failed','timeout','cancelled','blocked')
    )::int AS terminal_job_rows,
    max(updated_at) AS newest_job_update
  FROM aria_internal.execution_jobs
  GROUP BY mission_id
)
SELECT
  m.mission_id,
  m.status AS mission_status,
  coalesce(nullif(m.metadata->>'execution_lane',''),
           nullif(m.metadata->>'goal_source',''),
           'unclassified') AS lane,
  m.updated_at AS mission_updated_at,
  m.lease_until,
  coalesce(m.recovery_count,0) AS recovery_count,
  coalesce(j.job_rows,0) AS job_rows,
  coalesce(j.active_job_rows,0) AS active_job_rows,
  coalesce(j.terminal_job_rows,0) AS terminal_job_rows,
  j.newest_job_update
FROM aria_internal.mission_state AS m
LEFT JOIN jobs_by_mission AS j ON j.mission_id = m.mission_id
WHERE m.status IN ('queued','planning','running','waiting','paused')
ORDER BY
  CASE WHEN coalesce(j.active_job_rows,0) > 0 THEN 0 ELSE 1 END,
  m.updated_at ASC,
  m.mission_id
LIMIT 100;

-- 4) Execution-job backlog and recency by status/device.
SELECT
  status,
  coalesce(device_id, 'no_device') AS device_id,
  count(*)::int AS job_rows,
  count(*) FILTER (WHERE completed_at IS NULL)::int AS without_completion,
  min(requested_at) AS oldest_requested_at,
  max(updated_at) AS newest_updated_at,
  count(*) FILTER (WHERE lease_until IS NOT NULL AND lease_until <= now())::int AS expired_job_lease
FROM aria_internal.execution_jobs
GROUP BY status, device_id
ORDER BY job_rows DESC, status, device_id;

-- 5) Device registry freshness; "online" alone is not recent heartbeat proof.
SELECT
  device_id,
  status,
  last_seen_at,
  updated_at,
  now() - last_seen_at AS heartbeat_age,
  capabilities
FROM aria_internal.device_registry
ORDER BY last_seen_at NULLS FIRST, device_id;
