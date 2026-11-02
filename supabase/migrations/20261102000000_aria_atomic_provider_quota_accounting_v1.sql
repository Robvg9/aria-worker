BEGIN;

CREATE TABLE IF NOT EXISTS aria_internal.quota_request_reservations_v1 (
  reservation_key text PRIMARY KEY CHECK (length(reservation_key) BETWEEN 1 AND 240),
  provider_id text NOT NULL REFERENCES aria_internal.provider_registry(provider_id),
  account_id text NOT NULL REFERENCES aria_internal.account_registry(account_id),
  model_id text NOT NULL REFERENCES aria_internal.model_registry(model_id),
  model_quota_id text NOT NULL REFERENCES aria_internal.quota_registry(quota_id),
  account_quota_id text REFERENCES aria_internal.quota_registry(quota_id),
  model_period_start timestamptz,
  account_period_start timestamptz,
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'succeeded', 'failed', 'unknown')),
  provider_status integer,
  prompt_tokens bigint CHECK (prompt_tokens IS NULL OR prompt_tokens >= 0),
  completion_tokens bigint CHECK (completion_tokens IS NULL OR completion_tokens >= 0),
  total_tokens bigint CHECK (total_tokens IS NULL OR total_tokens >= 0),
  provider_response_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_quota_request_reservations_account_period
  ON aria_internal.quota_request_reservations_v1 (account_id, account_period_start DESC);

ALTER TABLE aria_internal.quota_request_reservations_v1 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE aria_internal.quota_request_reservations_v1 FROM PUBLIC, anon, authenticated, service_role;

-- OpenRouter's free-model daily limit belongs to the API key/account, not to a
-- single model row. Keep it separate from per-model telemetry and seed it as
-- UNKNOWN until execution runtime refreshes it from GET /api/v1/key.
UPDATE aria_internal.quota_registry
SET
  status = CASE WHEN status = 'disabled' THEN status ELSE 'unknown' END,
  limits_requests = 50,
  limits_period = 'day',
  usage_requests = COALESCE(usage_requests, 0),
  usage_period_start = NULL,
  usage_period_end = NULL,
  source_type = 'execution',
  evidence_ref = 'https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key',
  metadata = metadata || jsonb_build_object(
    'quota_scope', 'account_free_model_daily',
    'provider_usage_authority', 'GET /api/v1/key data.free_model_daily_requests',
    'atomic_reservations', true,
    'catalog_confirmed_at', '2026-11-02'
  ),
  notes = COALESCE(notes, '') || ' | Account-level free-model daily quota is refreshed from the provider before every inference; local reservations are atomic.'
WHERE provider_id = 'openrouter'
  AND account_id = 'acct_openrouter_primary'
  AND model_id IS NULL;

INSERT INTO aria_internal.quota_registry (
  quota_id, account_id, provider_id, model_id, status,
  limits_requests, limits_period, usage_requests,
  source_type, evidence_ref, metadata, notes
)
SELECT
  'quota_openrouter_account_free_daily',
  'acct_openrouter_primary',
  'openrouter',
  NULL,
  'unknown',
  50,
  'day',
  NULL,
  'execution',
  'https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key',
  jsonb_build_object(
    'quota_scope', 'account_free_model_daily',
    'provider_usage_authority', 'GET /api/v1/key data.free_model_daily_requests',
    'period_timezone', 'UTC',
    'atomic_reservations', true,
    'catalog_confirmed_at', '2026-11-02'
  ),
  'Account-wide daily free-model request cap. Usage is unknown until the live API key snapshot is read; never infer zero from missing provider data.'
WHERE NOT EXISTS (
  SELECT 1
  FROM aria_internal.quota_registry q
  WHERE q.provider_id = 'openrouter'
    AND q.account_id = 'acct_openrouter_primary'
    AND q.model_id IS NULL
);

-- Preserve the model row for route eligibility and model/token telemetry. Its
-- old per-model 50/day cap is no longer authoritative: OpenRouter reports the
-- enforced free-model daily counter at API-key scope.
UPDATE aria_internal.quota_registry
SET
  limits_requests = NULL,
  limits_period = NULL,
  usage_period_start = NULL,
  usage_period_end = NULL,
  metadata = metadata || jsonb_build_object(
    'request_quota_scope', 'account_free_model_daily',
    'request_quota_authority', 'quota_openrouter_account_free_daily'
  ),
  notes = COALESCE(notes, '') || ' | Per-model request limit disabled; account-wide OpenRouter daily free-model quota is authoritative.'
WHERE quota_id = 'quota_openrouter_nvidia_nemotron_35_lightning_free';

CREATE OR REPLACE FUNCTION aria_internal.quota_reserve_model_request_v1(
  p_reservation_key text,
  p_provider_id text,
  p_account_id text,
  p_model_id text,
  p_provider_used bigint DEFAULT NULL,
  p_provider_limit bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_day_start timestamptz := date_trunc('day', timezone('UTC', clock_timestamp())) AT TIME ZONE 'UTC';
  v_day_end timestamptz := (date_trunc('day', timezone('UTC', clock_timestamp())) + interval '1 day') AT TIME ZONE 'UTC';
  v_model_quota_id text;
  v_account_quota_id text;
  v_model_count integer;
  v_account_count integer := 0;
  v_model_row aria_internal.quota_registry%ROWTYPE;
  v_account_row aria_internal.quota_registry%ROWTYPE;
  v_model_usage bigint;
  v_account_usage bigint;
  v_model_period_start timestamptz;
  v_account_period_start timestamptz;
  v_inserted integer;
BEGIN
  IF p_reservation_key IS NULL OR length(p_reservation_key) NOT BETWEEN 1 AND 240
     OR p_provider_id IS NULL OR p_account_id IS NULL OR p_model_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_reservation_identity');
  END IF;

  SELECT count(*), min(q.quota_id)
  INTO v_model_count, v_model_quota_id
  FROM aria_internal.quota_registry q
  WHERE q.provider_id = p_provider_id
    AND q.account_id = p_account_id
    AND q.model_id = p_model_id;

  IF v_model_count <> 1 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'model_quota_missing_or_ambiguous');
  END IF;

  IF p_provider_id = 'openrouter' AND p_account_id = 'acct_openrouter_primary'
     AND right(p_model_id, 5) = ':free' THEN
    SELECT count(*), min(q.quota_id)
    INTO v_account_count, v_account_quota_id
    FROM aria_internal.quota_registry q
    WHERE q.provider_id = p_provider_id
      AND q.account_id = p_account_id
      AND q.model_id IS NULL;

    IF v_account_count <> 1 THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'account_free_daily_quota_missing_or_ambiguous');
    END IF;

    IF p_provider_used IS NULL OR p_provider_limit IS NULL
       OR p_provider_used < 0 OR p_provider_limit <= 0
       OR p_provider_used > p_provider_limit THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'provider_free_daily_quota_unverified');
    END IF;
  END IF;

  -- All reservations for one account/model lock both rows in stable order.
  -- Concurrent workers therefore cannot reserve the same remaining request.
  PERFORM q.quota_id
  FROM aria_internal.quota_registry q
  WHERE q.quota_id = v_model_quota_id
     OR q.quota_id = v_account_quota_id
  ORDER BY q.quota_id
  FOR UPDATE;

  SELECT * INTO v_model_row
  FROM aria_internal.quota_registry
  WHERE quota_id = v_model_quota_id;

  IF v_model_row.status <> 'available' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'model_quota_not_available');
  END IF;

  IF v_account_quota_id IS NOT NULL THEN
    SELECT * INTO v_account_row
    FROM aria_internal.quota_registry
    WHERE quota_id = v_account_quota_id;

    IF v_account_row.status = 'disabled' THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'account_free_daily_quota_disabled');
    END IF;

    IF v_account_row.usage_period_start IS DISTINCT FROM v_day_start THEN
      v_account_usage := p_provider_used;
    ELSE
      v_account_usage := GREATEST(COALESCE(v_account_row.usage_requests, p_provider_used), p_provider_used);
    END IF;

    UPDATE aria_internal.quota_registry
    SET
      limits_requests = p_provider_limit,
      limits_period = 'day',
      usage_requests = v_account_usage,
      usage_period_start = v_day_start,
      usage_period_end = v_day_end,
      status = CASE WHEN v_account_usage >= p_provider_limit THEN 'exhausted' ELSE 'available' END,
      metadata = metadata || jsonb_build_object(
        'provider_usage_synced_at', v_now,
        'provider_usage_source', 'GET /api/v1/key data.free_model_daily_requests',
        'provider_daily_used', p_provider_used,
        'provider_daily_limit', p_provider_limit
      ),
      updated_at = v_now
    WHERE quota_id = v_account_quota_id;

    IF v_account_usage >= p_provider_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'account_free_daily_quota_exhausted',
        'used', v_account_usage,
        'limit', p_provider_limit
      );
    END IF;

    v_account_period_start := v_day_start;
  END IF;

  IF v_model_row.limits_requests IS NOT NULL AND v_account_quota_id IS NULL THEN
    IF v_model_row.limits_period = 'day'
       AND v_model_row.usage_period_end IS NOT NULL
       AND v_model_row.usage_period_end <= v_now THEN
      v_model_usage := 0;
      v_model_period_start := v_day_start;
    ELSE
      v_model_usage := v_model_row.usage_requests;
      v_model_period_start := v_model_row.usage_period_start;
      IF v_model_usage IS NULL THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'model_quota_usage_unknown');
      END IF;
    END IF;

    IF v_model_usage >= v_model_row.limits_requests THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason', 'model_quota_exhausted',
        'used', v_model_usage,
        'limit', v_model_row.limits_requests
      );
    END IF;
  ELSE
    v_model_usage := COALESCE(v_model_row.usage_requests, 0);
    IF v_model_row.limits_period = 'day' THEN
      IF v_model_row.usage_period_end IS NULL OR v_model_row.usage_period_end <= v_now THEN
        v_model_usage := 0;
      END IF;
      v_model_period_start := v_day_start;
    ELSE
      v_model_period_start := v_model_row.usage_period_start;
    END IF;
  END IF;

  INSERT INTO aria_internal.quota_request_reservations_v1 (
    reservation_key, provider_id, account_id, model_id,
    model_quota_id, account_quota_id,
    model_period_start, account_period_start,
    status, metadata
  )
  VALUES (
    p_reservation_key, p_provider_id, p_account_id, p_model_id,
    v_model_quota_id, v_account_quota_id,
    v_model_period_start, v_account_period_start,
    'reserved',
    jsonb_build_object('reservation_version', 'aria-quota-reservation-v1')
  )
  ON CONFLICT (reservation_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'duplicate_reservation_key');
  END IF;

  UPDATE aria_internal.quota_registry
  SET
    usage_requests = v_model_usage + 1,
    usage_period_start = CASE WHEN limits_period = 'day' THEN v_day_start ELSE usage_period_start END,
    usage_period_end = CASE WHEN limits_period = 'day' THEN v_day_end ELSE usage_period_end END,
    updated_at = v_now
  WHERE quota_id = v_model_quota_id;

  IF v_account_quota_id IS NOT NULL THEN
    UPDATE aria_internal.quota_registry
    SET
      usage_requests = v_account_usage + 1,
      status = CASE WHEN v_account_usage + 1 >= p_provider_limit THEN 'exhausted' ELSE 'available' END,
      updated_at = v_now
    WHERE quota_id = v_account_quota_id;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_key', p_reservation_key,
    'provider_id', p_provider_id,
    'account_id', p_account_id,
    'model_id', p_model_id,
    'account_daily_used_after_reserve', CASE WHEN v_account_quota_id IS NULL THEN NULL ELSE v_account_usage + 1 END,
    'account_daily_limit', p_provider_limit
  );
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.quota_settle_model_request_v1(
  p_reservation_key text,
  p_outcome text,
  p_provider_status integer DEFAULT NULL,
  p_prompt_tokens bigint DEFAULT NULL,
  p_completion_tokens bigint DEFAULT NULL,
  p_total_tokens bigint DEFAULT NULL,
  p_provider_response_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_reservation aria_internal.quota_request_reservations_v1%ROWTYPE;
  v_rows integer;
  v_total bigint;
BEGIN
  IF p_reservation_key IS NULL OR length(p_reservation_key) NOT BETWEEN 1 AND 240
     OR p_outcome NOT IN ('succeeded', 'failed', 'unknown')
     OR p_prompt_tokens < 0 OR p_completion_tokens < 0 OR p_total_tokens < 0 THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'invalid_settlement');
  END IF;

  v_total := p_total_tokens;
  IF v_total IS NULL AND p_prompt_tokens IS NOT NULL AND p_completion_tokens IS NOT NULL THEN
    v_total := p_prompt_tokens + p_completion_tokens;
  END IF;

  UPDATE aria_internal.quota_request_reservations_v1
  SET
    status = p_outcome,
    provider_status = p_provider_status,
    prompt_tokens = p_prompt_tokens,
    completion_tokens = p_completion_tokens,
    total_tokens = v_total,
    provider_response_id = NULLIF(left(COALESCE(p_provider_response_id, ''), 240), ''),
    settled_at = clock_timestamp()
  WHERE reservation_key = p_reservation_key
    AND status = 'reserved'
  RETURNING * INTO v_reservation;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    SELECT * INTO v_reservation
    FROM aria_internal.quota_request_reservations_v1
    WHERE reservation_key = p_reservation_key;

    RETURN jsonb_build_object(
      'settled', false,
      'already_settled', FOUND,
      'reason', CASE WHEN FOUND THEN 'reservation_already_settled' ELSE 'reservation_not_found' END
    );
  END IF;

  UPDATE aria_internal.quota_registry
  SET
    usage_tokens_input = CASE WHEN p_prompt_tokens IS NULL THEN usage_tokens_input ELSE COALESCE(usage_tokens_input, 0) + p_prompt_tokens END,
    usage_tokens_output = CASE WHEN p_completion_tokens IS NULL THEN usage_tokens_output ELSE COALESCE(usage_tokens_output, 0) + p_completion_tokens END,
    usage_tokens_total = CASE WHEN v_total IS NULL THEN usage_tokens_total ELSE COALESCE(usage_tokens_total, 0) + v_total END,
    updated_at = clock_timestamp()
  WHERE quota_id = v_reservation.model_quota_id
    AND usage_period_start IS NOT DISTINCT FROM v_reservation.model_period_start;

  IF v_reservation.account_quota_id IS NOT NULL THEN
    UPDATE aria_internal.quota_registry
    SET
      usage_tokens_input = CASE WHEN p_prompt_tokens IS NULL THEN usage_tokens_input ELSE COALESCE(usage_tokens_input, 0) + p_prompt_tokens END,
      usage_tokens_output = CASE WHEN p_completion_tokens IS NULL THEN usage_tokens_output ELSE COALESCE(usage_tokens_output, 0) + p_completion_tokens END,
      usage_tokens_total = CASE WHEN v_total IS NULL THEN usage_tokens_total ELSE COALESCE(usage_tokens_total, 0) + v_total END,
      updated_at = clock_timestamp()
    WHERE quota_id = v_reservation.account_quota_id
      AND usage_period_start IS NOT DISTINCT FROM v_reservation.account_period_start;
  END IF;

  RETURN jsonb_build_object(
    'settled', true,
    'reservation_key', p_reservation_key,
    'status', p_outcome,
    'provider_status', p_provider_status
  );
END;
$function$;

REVOKE ALL ON FUNCTION aria_internal.quota_reserve_model_request_v1(text, text, text, text, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.quota_settle_model_request_v1(text, text, integer, bigint, bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.quota_reserve_model_request_v1(text, text, text, text, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.quota_settle_model_request_v1(text, text, integer, bigint, bigint, bigint, text) TO service_role;

-- Backfill the single confirmed live inference from Gate 3. This is idempotent
-- evidence reconciliation, not an estimate: the mission result itself records
-- Nemotron Free, provider response ID and token usage. Provider API usage is
-- still refreshed before every future free-model request.
DO $backfill$
DECLARE
  v_finished_at timestamptz;
  v_prompt_tokens bigint;
  v_completion_tokens bigint;
  v_total_tokens bigint;
  v_provider_response_id text;
  v_inserted integer;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  SELECT
    m.finished_at,
    NULLIF(m.checkpoint #>> '{results,gate3_provider_fallback,usage,prompt_tokens}', '')::bigint,
    NULLIF(m.checkpoint #>> '{results,gate3_provider_fallback,usage,completion_tokens}', '')::bigint,
    NULLIF(m.checkpoint #>> '{results,gate3_provider_fallback,usage,total_tokens}', '')::bigint,
    NULLIF(m.checkpoint #>> '{results,gate3_provider_fallback,response,provider_response_id}', '')
  INTO
    v_finished_at, v_prompt_tokens, v_completion_tokens, v_total_tokens, v_provider_response_id
  FROM aria_internal.mission_state m
  WHERE m.mission_id = 'mission_wonder_2_gate3_probe_41388796601_1'
    AND m.status = 'succeeded'
    AND m.completed_steps = 1
    AND m.total_steps = 1
    AND m.checkpoint #>> '{results,gate3_provider_fallback,status}' = 'succeeded'
    AND m.checkpoint #>> '{results,gate3_provider_fallback,provider_id}' = 'openrouter'
    AND m.checkpoint #>> '{results,gate3_provider_fallback,model_id}' = 'nvidia/nemotron-3.5-lightning:free';

  IF v_finished_at IS NOT NULL THEN
    v_period_start := date_trunc('day', timezone('UTC', v_finished_at)) AT TIME ZONE 'UTC';
    v_period_end := (date_trunc('day', timezone('UTC', v_finished_at)) + interval '1 day') AT TIME ZONE 'UTC';

    INSERT INTO aria_internal.quota_request_reservations_v1 (
      reservation_key, provider_id, account_id, model_id,
      model_quota_id, account_quota_id, model_period_start, account_period_start,
      status, provider_status, prompt_tokens, completion_tokens, total_tokens,
      provider_response_id, metadata, reserved_at, settled_at
    )
    SELECT
      'historical:mission_wonder_2_gate3_probe_41388796601_1',
      'openrouter',
      'acct_openrouter_primary',
      'nvidia/nemotron-3.5-lightning:free',
      model_quota.quota_id,
      account_quota.quota_id,
      NULL,
      v_period_start,
      'succeeded',
      200,
      v_prompt_tokens,
      v_completion_tokens,
      COALESCE(v_total_tokens, v_prompt_tokens + v_completion_tokens),
      v_provider_response_id,
      jsonb_build_object(
        'source', 'verified_gate3_live_mission',
        'workflow_run', '41388796601',
        'evidence_ref', 'https://github.com/Robvg9/aria-worker/actions/runs/41388796601'
      ),
      v_finished_at,
      v_finished_at
    FROM aria_internal.quota_registry model_quota
    CROSS JOIN aria_internal.quota_registry account_quota
    WHERE model_quota.quota_id = 'quota_openrouter_nvidia_nemotron_35_lightning_free'
      AND account_quota.provider_id = 'openrouter'
      AND account_quota.account_id = 'acct_openrouter_primary'
      AND account_quota.model_id IS NULL
    ON CONFLICT (reservation_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      UPDATE aria_internal.quota_registry
      SET
        usage_requests = COALESCE(usage_requests, 0) + 1,
        usage_tokens_input = CASE WHEN v_prompt_tokens IS NULL THEN usage_tokens_input ELSE COALESCE(usage_tokens_input, 0) + v_prompt_tokens END,
        usage_tokens_output = CASE WHEN v_completion_tokens IS NULL THEN usage_tokens_output ELSE COALESCE(usage_tokens_output, 0) + v_completion_tokens END,
        usage_tokens_total = CASE WHEN COALESCE(v_total_tokens, v_prompt_tokens + v_completion_tokens) IS NULL THEN usage_tokens_total ELSE COALESCE(usage_tokens_total, 0) + COALESCE(v_total_tokens, v_prompt_tokens + v_completion_tokens) END,
        metadata = metadata || jsonb_build_object('verified_gate3_historical_requests_backfilled', 1),
        updated_at = v_finished_at
      WHERE quota_id = 'quota_openrouter_nvidia_nemotron_35_lightning_free';

      UPDATE aria_internal.quota_registry
      SET
        usage_requests = CASE WHEN usage_period_start = v_period_start THEN COALESCE(usage_requests, 0) + 1 ELSE 1 END,
        usage_tokens_input = CASE WHEN v_prompt_tokens IS NULL THEN usage_tokens_input WHEN usage_period_start = v_period_start THEN COALESCE(usage_tokens_input, 0) + v_prompt_tokens ELSE v_prompt_tokens END,
        usage_tokens_output = CASE WHEN v_completion_tokens IS NULL THEN usage_tokens_output WHEN usage_period_start = v_period_start THEN COALESCE(usage_tokens_output, 0) + v_completion_tokens ELSE v_completion_tokens END,
        usage_tokens_total = CASE WHEN COALESCE(v_total_tokens, v_prompt_tokens + v_completion_tokens) IS NULL THEN usage_tokens_total WHEN usage_period_start = v_period_start THEN COALESCE(usage_tokens_total, 0) + COALESCE(v_total_tokens, v_prompt_tokens + v_completion_tokens) ELSE COALESCE(v_total_tokens, v_prompt_tokens + v_completion_tokens) END,
        usage_period_start = v_period_start,
        usage_period_end = v_period_end,
        metadata = metadata || jsonb_build_object('verified_gate3_historical_requests_backfilled', 1),
        updated_at = v_finished_at
      WHERE provider_id = 'openrouter'
        AND account_id = 'acct_openrouter_primary'
        AND model_id IS NULL;
    END IF;
  END IF;
END;
$backfill$;

COMMIT;
