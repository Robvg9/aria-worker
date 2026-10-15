-- Persist sanitized results for the authenticated Step 5 HTTP probes.
-- Only response status/body and route IDs are stored; Vault credentials are never selected into evidence.

BEGIN;

DO $capture_authenticated_http_probe_results$
DECLARE
  v_probe_id uuid;
  v_pass_count integer;
  v_total_count integer;
BEGIN
  SELECT probe_id
    INTO v_probe_id
    FROM aria_internal.aria_encrypt_step5_http_probe_evidence
   GROUP BY probe_id
   ORDER BY max(requested_at) DESC
   LIMIT 1;

  IF v_probe_id IS NULL THEN
    RAISE EXCEPTION 'E2E_FAIL: authenticated HTTP probe batch missing';
  END IF;

  UPDATE aria_internal.aria_encrypt_step5_http_probe_evidence e
     SET status_code = r.status_code,
         response_body = r.content::jsonb,
         passed = (
           r.status_code = e.expected_status_code
           AND (r.content::jsonb->>'code') = 'ARIA_MEMORY_PRIVACY_GATE_CLOSED'
           AND coalesce(r.timed_out,false) = false
           AND r.error_msg IS NULL
         ),
         checked_at = now()
    FROM net._http_response r
   WHERE e.probe_id = v_probe_id
     AND e.request_id = r.id;

  SELECT count(*), count(*) FILTER (WHERE passed IS TRUE)
    INTO v_total_count, v_pass_count
    FROM aria_internal.aria_encrypt_step5_http_probe_evidence
   WHERE probe_id = v_probe_id;

  IF v_total_count <> 4 OR v_pass_count <> 4 THEN
    RAISE EXCEPTION 'E2E_FAIL: expected four authenticated 503 responses; total %, passed %',
      v_total_count, v_pass_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM aria_internal.aria_encrypt_step5_http_probe_evidence e
      LEFT JOIN net._http_response r ON r.id = e.request_id
     WHERE e.probe_id = v_probe_id
       AND (r.id IS NULL OR r.status_code IS DISTINCT FROM 503
            OR (r.content::jsonb->>'code') IS DISTINCT FROM 'ARIA_MEMORY_PRIVACY_GATE_CLOSED')
  ) THEN
    RAISE EXCEPTION 'E2E_FAIL: HTTP response body or status differs from expected privacy gate';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM net.http_request_queue q
      JOIN aria_internal.aria_encrypt_step5_http_probe_evidence e ON e.request_id = q.id
     WHERE e.probe_id = v_probe_id
  ) THEN
    RAISE EXCEPTION 'E2E_FAIL: authenticated probe requests remain queued';
  END IF;
END
$capture_authenticated_http_probe_results$;

COMMIT;
