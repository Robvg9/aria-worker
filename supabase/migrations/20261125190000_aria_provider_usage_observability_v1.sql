BEGIN;

ALTER TABLE aria_internal.quota_request_reservations_v1
  ADD COLUMN IF NOT EXISTS cached_input_tokens bigint
    CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0);

ALTER TABLE aria_internal.quota_registry
  ADD COLUMN IF NOT EXISTS observed_remaining_requests bigint
    CHECK (observed_remaining_requests IS NULL OR observed_remaining_requests >= 0),
  ADD COLUMN IF NOT EXISTS quota_observed_at timestamptz,
  ADD COLUMN IF NOT EXISTS quota_observation_source text;

COMMENT ON COLUMN aria_internal.quota_request_reservations_v1.cached_input_tokens IS
  'Provider-reported cached input tokens for this request; NULL when not reported.';
COMMENT ON COLUMN aria_internal.quota_registry.observed_remaining_requests IS
  'Provider-reported quota remaining from a timestamped snapshot; NULL when unknown.';
COMMENT ON COLUMN aria_internal.quota_registry.quota_observed_at IS
  'Timestamp of the provider quota snapshot; not a predicted reset time.';
COMMENT ON COLUMN aria_internal.quota_registry.quota_observation_source IS
  'Exact source used to observe the quota snapshot.';

CREATE OR REPLACE FUNCTION aria_internal.quota_reserve_model_request_v2(
  p_reservation_key text,
  p_provider_id text,
  p_account_id text,
  p_model_id text,
  p_provider_used bigint DEFAULT NULL,
  p_provider_limit bigint DEFAULT NULL,
  p_provider_remaining bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
  v_observed_at timestamptz := clock_timestamp();
  v_openrouter_free boolean :=
    p_provider_id = 'openrouter'
    AND p_account_id = 'acct_openrouter_primary'
    AND right(COALESCE(p_model_id, ''), 5) = ':free';
BEGIN
  IF v_openrouter_free AND (
    p_provider_used IS NULL OR p_provider_limit IS NULL OR p_provider_remaining IS NULL
    OR p_provider_used < 0 OR p_provider_limit <= 0 OR p_provider_remaining < 0
    OR p_provider_used > p_provider_limit OR p_provider_remaining > p_provider_limit
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'provider_free_daily_quota_unverified');
  END IF;

  v_result := aria_internal.quota_reserve_model_request_v1(
    p_reservation_key,
    p_provider_id,
    p_account_id,
    p_model_id,
    p_provider_used,
    p_provider_limit
  );

  IF v_openrouter_free THEN
    UPDATE aria_internal.quota_registry
    SET
      observed_remaining_requests = p_provider_remaining,
      quota_observed_at = v_observed_at,
      quota_observation_source = 'https://openrouter.ai/api/v1/key',
      metadata = metadata || jsonb_build_object(
        'provider_daily_used', p_provider_used,
        'provider_daily_limit', p_provider_limit,
        'provider_daily_remaining', p_provider_remaining,
        'provider_usage_synced_at', v_observed_at,
        'provider_usage_source', 'GET https://openrouter.ai/api/v1/key'
      ),
      updated_at = v_observed_at
    WHERE provider_id = p_provider_id
      AND account_id = p_account_id
      AND model_id IS NULL;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.quota_settle_model_request_v2(
  p_reservation_key text,
  p_outcome text,
  p_provider_status integer DEFAULT NULL,
  p_prompt_tokens bigint DEFAULT NULL,
  p_completion_tokens bigint DEFAULT NULL,
  p_total_tokens bigint DEFAULT NULL,
  p_provider_response_id text DEFAULT NULL,
  p_cached_input_tokens bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_cached_input_tokens < 0 THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'invalid_cached_input_tokens');
  END IF;

  v_result := aria_internal.quota_settle_model_request_v1(
    p_reservation_key,
    p_outcome,
    p_provider_status,
    p_prompt_tokens,
    p_completion_tokens,
    p_total_tokens,
    p_provider_response_id
  );

  IF COALESCE((v_result ->> 'settled')::boolean, false) AND p_cached_input_tokens IS NOT NULL THEN
    UPDATE aria_internal.quota_request_reservations_v1
    SET cached_input_tokens = p_cached_input_tokens
    WHERE reservation_key = p_reservation_key
      AND status = p_outcome;
  END IF;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE VIEW aria_internal.provider_execution_observability_v1 AS
SELECT
  provider_id,
  account_id,
  model_id,
  count(*)::bigint AS requests_reserved,
  count(*) FILTER (WHERE status = 'succeeded')::bigint AS requests_succeeded,
  count(*) FILTER (WHERE status = 'failed')::bigint AS requests_failed,
  count(*) FILTER (WHERE status = 'unknown')::bigint AS requests_unknown,
  count(*) FILTER (WHERE status = 'reserved')::bigint AS requests_still_reserved,
  count(*) FILTER (WHERE provider_status = 402)::bigint AS provider_http_402,
  count(*) FILTER (WHERE provider_status = 429)::bigint AS provider_http_429,
  count(*) FILTER (WHERE provider_status BETWEEN 500 AND 599)::bigint AS provider_http_5xx,
  sum(prompt_tokens) AS prompt_tokens_reported_sum,
  count(*) FILTER (WHERE prompt_tokens IS NOT NULL)::bigint AS prompt_token_observations,
  sum(completion_tokens) AS completion_tokens_reported_sum,
  count(*) FILTER (WHERE completion_tokens IS NOT NULL)::bigint AS completion_token_observations,
  sum(total_tokens) AS total_tokens_reported_sum,
  count(*) FILTER (WHERE total_tokens IS NOT NULL)::bigint AS total_token_observations,
  sum(cached_input_tokens) AS cached_input_tokens_reported_sum,
  count(*) FILTER (WHERE cached_input_tokens IS NOT NULL)::bigint AS cached_input_token_observations,
  avg(EXTRACT(EPOCH FROM (settled_at - reserved_at)) * 1000)
    FILTER (WHERE settled_at > reserved_at) AS avg_reservation_to_settlement_ms,
  percentile_cont(0.95) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (settled_at - reserved_at)) * 1000
  ) FILTER (WHERE settled_at > reserved_at) AS p95_reservation_to_settlement_ms,
  max(settled_at) AS last_settled_at,
  max(reserved_at) AS last_reserved_at
FROM aria_internal.quota_request_reservations_v1
GROUP BY provider_id, account_id, model_id;

COMMENT ON VIEW aria_internal.provider_execution_observability_v1 IS
  'Aggregated provider execution/token/error telemetry. Reservation-to-settlement duration is a measured end-to-end accounting interval, not isolated upstream latency. Token sums include only provider-reported values; observation counts expose missing measurements.';

CREATE OR REPLACE VIEW aria_internal.provider_quota_capacity_v1 AS
SELECT
  quota_id,
  provider_id,
  account_id,
  model_id,
  status,
  limits_requests,
  usage_requests,
  CASE
    WHEN limits_requests IS NOT NULL AND usage_requests IS NOT NULL
      THEN GREATEST(limits_requests - usage_requests, 0)
    ELSE NULL
  END AS remaining_requests_derived,
  observed_remaining_requests AS provider_reported_remaining_requests,
  limits_tokens_input,
  limits_tokens_output,
  limits_tokens_total,
  usage_tokens_input,
  usage_tokens_output,
  usage_tokens_total,
  limits_period,
  usage_period_start,
  usage_period_end AS quota_window_end,
  quota_observed_at,
  quota_observation_source,
  source_type,
  evidence_ref,
  updated_at AS registry_updated_at
FROM aria_internal.quota_registry;

COMMENT ON VIEW aria_internal.provider_quota_capacity_v1 IS
  'Quota/capacity read model. Unknown limits or usage yield NULL remaining. quota_window_end is the recorded window boundary, not a provider reset_at guarantee. Provider-reported remaining is kept separate from locally derived remaining.';

REVOKE ALL ON FUNCTION aria_internal.quota_reserve_model_request_v2(text, text, text, text, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.quota_settle_model_request_v2(text, text, integer, bigint, bigint, bigint, text, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.quota_reserve_model_request_v2(text, text, text, text, bigint, bigint, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.quota_settle_model_request_v2(text, text, integer, bigint, bigint, bigint, text, bigint) TO service_role;

REVOKE ALL ON aria_internal.provider_execution_observability_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON aria_internal.provider_quota_capacity_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON aria_internal.provider_execution_observability_v1 TO service_role;
GRANT SELECT ON aria_internal.provider_quota_capacity_v1 TO service_role;

COMMIT;
