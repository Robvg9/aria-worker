BEGIN;

CREATE TABLE IF NOT EXISTS aria_internal.mission_budget_policies_v1 (
  policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id text NOT NULL
    REFERENCES aria_internal.mission_state(mission_id) ON DELETE RESTRICT,
  policy_version integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'revoked')),
  max_requests bigint CHECK (max_requests IS NULL OR max_requests >= 0),
  max_total_tokens bigint CHECK (max_total_tokens IS NULL OR max_total_tokens >= 0),
  max_cost_amount numeric(20,8)
    CHECK (max_cost_amount IS NULL OR max_cost_amount >= 0),
  currency_code text
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  reserve_test_requests bigint NOT NULL DEFAULT 0 CHECK (reserve_test_requests >= 0),
  reserve_close_requests bigint NOT NULL DEFAULT 0 CHECK (reserve_close_requests >= 0),
  reserve_test_tokens bigint NOT NULL DEFAULT 0 CHECK (reserve_test_tokens >= 0),
  reserve_close_tokens bigint NOT NULL DEFAULT 0 CHECK (reserve_close_tokens >= 0),
  reserve_test_cost_amount numeric(20,8) NOT NULL DEFAULT 0
    CHECK (reserve_test_cost_amount >= 0),
  reserve_close_cost_amount numeric(20,8) NOT NULL DEFAULT 0
    CHECK (reserve_close_cost_amount >= 0),
  approval_ref text,
  approved_by text,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT mission_budget_policy_version_unique UNIQUE (mission_id, policy_version),
  CONSTRAINT mission_budget_policy_approved_evidence CHECK (
    status <> 'approved'
    OR (
      NULLIF(btrim(approval_ref), '') IS NOT NULL
      AND NULLIF(btrim(approved_by), '') IS NOT NULL
      AND approved_at IS NOT NULL
      AND (
        max_requests IS NOT NULL
        OR max_total_tokens IS NOT NULL
        OR max_cost_amount IS NOT NULL
      )
    )
  ),
  CONSTRAINT mission_budget_policy_revocation_consistency CHECK (
    (status = 'revoked') = (revoked_at IS NOT NULL)
  ),
  CONSTRAINT mission_budget_policy_cost_currency CHECK (
    (max_cost_amount IS NULL AND currency_code IS NULL
      AND reserve_test_cost_amount = 0 AND reserve_close_cost_amount = 0)
    OR
    (max_cost_amount IS NOT NULL AND currency_code ~ '^[A-Z]{3}$'
      AND reserve_test_cost_amount + reserve_close_cost_amount <= max_cost_amount)
  ),
  CONSTRAINT mission_budget_policy_request_reserves CHECK (
    (max_requests IS NULL AND reserve_test_requests = 0 AND reserve_close_requests = 0)
    OR
    (max_requests IS NOT NULL
      AND reserve_test_requests + reserve_close_requests <= max_requests)
  ),
  CONSTRAINT mission_budget_policy_token_reserves CHECK (
    (max_total_tokens IS NULL AND reserve_test_tokens = 0 AND reserve_close_tokens = 0)
    OR
    (max_total_tokens IS NOT NULL
      AND reserve_test_tokens + reserve_close_tokens <= max_total_tokens)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mission_budget_one_approved_policy_per_mission_v1
  ON aria_internal.mission_budget_policies_v1 (mission_id)
  WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS mission_budget_policies_mission_version_v1
  ON aria_internal.mission_budget_policies_v1 (mission_id, policy_version DESC);

CREATE TABLE IF NOT EXISTS aria_internal.mission_budget_reservations_v1 (
  reservation_key text PRIMARY KEY
    CHECK (length(reservation_key) BETWEEN 1 AND 240),
  mission_id text NOT NULL
    REFERENCES aria_internal.mission_state(mission_id) ON DELETE RESTRICT,
  policy_id uuid NOT NULL
    REFERENCES aria_internal.mission_budget_policies_v1(policy_id) ON DELETE RESTRICT,
  request_kind text NOT NULL
    CHECK (request_kind IN ('execution', 'test', 'closure')),
  estimated_tokens bigint CHECK (estimated_tokens IS NULL OR estimated_tokens >= 0),
  estimated_cost_amount numeric(20,8)
    CHECK (estimated_cost_amount IS NULL OR estimated_cost_amount >= 0),
  currency_code text
    CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  actual_tokens bigint CHECK (actual_tokens IS NULL OR actual_tokens >= 0),
  actual_cost_amount numeric(20,8)
    CHECK (actual_cost_amount IS NULL OR actual_cost_amount >= 0),
  actual_currency_code text
    CHECK (actual_currency_code IS NULL OR actual_currency_code ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'succeeded', 'failed', 'unknown', 'released')),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  settled_at timestamptz,
  CONSTRAINT mission_budget_reservation_estimated_cost_currency CHECK (
    (estimated_cost_amount IS NULL) = (currency_code IS NULL)
  ),
  CONSTRAINT mission_budget_reservation_actual_cost_currency CHECK (
    (actual_cost_amount IS NULL) = (actual_currency_code IS NULL)
  ),
  CONSTRAINT mission_budget_reservation_settlement_consistency CHECK (
    (status = 'reserved' AND settled_at IS NULL)
    OR (status <> 'reserved' AND settled_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS mission_budget_reservations_mission_v1
  ON aria_internal.mission_budget_reservations_v1 (mission_id, policy_id, reserved_at);

CREATE OR REPLACE FUNCTION aria_internal.mission_budget_policy_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mission budget policies are append-only; revoke or create a new version';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'mission budget policies must begin as draft';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' THEN
    IF NEW.status <> 'revoked'
      OR ROW(
        NEW.policy_id, NEW.mission_id, NEW.policy_version,
        NEW.max_requests, NEW.max_total_tokens, NEW.max_cost_amount, NEW.currency_code,
        NEW.reserve_test_requests, NEW.reserve_close_requests,
        NEW.reserve_test_tokens, NEW.reserve_close_tokens,
        NEW.reserve_test_cost_amount, NEW.reserve_close_cost_amount,
        NEW.approval_ref, NEW.approved_by, NEW.approved_at, NEW.created_at
      ) IS DISTINCT FROM ROW(
        OLD.policy_id, OLD.mission_id, OLD.policy_version,
        OLD.max_requests, OLD.max_total_tokens, OLD.max_cost_amount, OLD.currency_code,
        OLD.reserve_test_requests, OLD.reserve_close_requests,
        OLD.reserve_test_tokens, OLD.reserve_close_tokens,
        OLD.reserve_test_cost_amount, OLD.reserve_close_cost_amount,
        OLD.approval_ref, OLD.approved_by, OLD.approved_at, OLD.created_at
      )
    THEN
      RAISE EXCEPTION 'approved mission budget policies are immutable; revoke and create a new version';
    END IF;
    NEW.revoked_at := clock_timestamp();
  ELSIF OLD.status = 'revoked' THEN
    RAISE EXCEPTION 'revoked mission budget policies are immutable';
  ELSIF NEW.status NOT IN ('draft', 'approved') THEN
    RAISE EXCEPTION 'invalid mission budget policy state transition';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mission_budget_policy_guard_v1
  ON aria_internal.mission_budget_policies_v1;
CREATE TRIGGER mission_budget_policy_guard_v1
  BEFORE INSERT OR UPDATE OR DELETE
  ON aria_internal.mission_budget_policies_v1
  FOR EACH ROW
  EXECUTE FUNCTION aria_internal.mission_budget_policy_guard_v1();

CREATE OR REPLACE FUNCTION aria_internal.mission_budget_reservation_guard_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'mission budget reservations are immutable; settle or retain unknown state';
  END IF;

  IF OLD.status <> 'reserved' OR NEW.status = 'reserved' THEN
    RAISE EXCEPTION 'mission budget reservations can be finalized only once';
  END IF;

  IF ROW(
    NEW.reservation_key, NEW.mission_id, NEW.policy_id, NEW.request_kind,
    NEW.estimated_tokens, NEW.estimated_cost_amount, NEW.currency_code, NEW.reserved_at
  ) IS DISTINCT FROM ROW(
    OLD.reservation_key, OLD.mission_id, OLD.policy_id, OLD.request_kind,
    OLD.estimated_tokens, OLD.estimated_cost_amount, OLD.currency_code, OLD.reserved_at
  ) THEN
    RAISE EXCEPTION 'mission budget reservation identity and estimates are immutable';
  END IF;

  IF NEW.status = 'released'
    AND (NEW.actual_tokens IS NOT NULL OR NEW.actual_cost_amount IS NOT NULL)
  THEN
    RAISE EXCEPTION 'released reservations cannot contain provider usage';
  END IF;

  NEW.settled_at := clock_timestamp();
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS mission_budget_reservation_guard_v1
  ON aria_internal.mission_budget_reservations_v1;
CREATE TRIGGER mission_budget_reservation_guard_v1
  BEFORE UPDATE OR DELETE
  ON aria_internal.mission_budget_reservations_v1
  FOR EACH ROW
  EXECUTE FUNCTION aria_internal.mission_budget_reservation_guard_v1();

CREATE OR REPLACE FUNCTION aria_internal.mission_budget_reserve_request_v1(
  p_mission_id text,
  p_reservation_key text,
  p_request_kind text,
  p_estimated_tokens bigint DEFAULT NULL,
  p_estimated_cost_amount numeric DEFAULT NULL,
  p_currency_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy aria_internal.mission_budget_policies_v1%ROWTYPE;
  v_latest_status text;
  v_requests_used bigint := 0;
  v_test_requests_used bigint := 0;
  v_close_requests_used bigint := 0;
  v_tokens_used numeric := 0;
  v_test_tokens_used numeric := 0;
  v_close_tokens_used numeric := 0;
  v_cost_used numeric := 0;
  v_test_cost_used numeric := 0;
  v_close_cost_used numeric := 0;
BEGIN
  IF NULLIF(btrim(p_mission_id), '') IS NULL
    OR COALESCE(length(btrim(p_reservation_key)), 0) NOT BETWEEN 1 AND 240
    OR p_request_kind IS NULL
    OR p_request_kind NOT IN ('execution', 'test', 'closure')
    OR p_estimated_tokens < 0
    OR p_estimated_cost_amount < 0
    OR ((p_estimated_cost_amount IS NULL) <> (p_currency_code IS NULL))
    OR (p_currency_code IS NOT NULL AND p_currency_code !~ '^[A-Z]{3}$')
  THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_budget_reservation_input');
  END IF;

  SELECT status INTO v_latest_status
  FROM aria_internal.mission_budget_policies_v1
  WHERE mission_id = p_mission_id
  ORDER BY policy_version DESC
  LIMIT 1;

  SELECT * INTO v_policy
  FROM aria_internal.mission_budget_policies_v1
  WHERE mission_id = p_mission_id AND status = 'approved'
  FOR UPDATE;

  IF NOT FOUND THEN
    IF v_latest_status IS NULL THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_policy_missing');
    END IF;
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', CASE WHEN v_latest_status = 'revoked'
        THEN 'mission_budget_policy_revoked'
        ELSE 'mission_budget_policy_not_approved' END
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM aria_internal.mission_budget_reservations_v1
    WHERE reservation_key = p_reservation_key
  ) THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_reservation_key_already_used');
  END IF;

  IF v_policy.max_total_tokens IS NOT NULL AND p_estimated_tokens IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_token_estimate_unknown');
  END IF;

  IF v_policy.max_cost_amount IS NOT NULL AND p_estimated_cost_amount IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_cost_estimate_unknown');
  END IF;

  IF v_policy.max_cost_amount IS NOT NULL AND p_currency_code IS DISTINCT FROM v_policy.currency_code THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_currency_mismatch');
  END IF;

  SELECT
    count(*) FILTER (WHERE status <> 'released')::bigint,
    count(*) FILTER (WHERE request_kind = 'test' AND status <> 'released')::bigint,
    count(*) FILTER (WHERE request_kind = 'closure' AND status <> 'released')::bigint,
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE request_kind = 'test' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE request_kind = 'closure' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE request_kind = 'test' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE request_kind = 'closure' AND status <> 'released'), 0)
  INTO
    v_requests_used, v_test_requests_used, v_close_requests_used,
    v_tokens_used, v_test_tokens_used, v_close_tokens_used,
    v_cost_used, v_test_cost_used, v_close_cost_used
  FROM aria_internal.mission_budget_reservations_v1
  WHERE mission_id = p_mission_id AND policy_id = v_policy.policy_id;

  IF v_policy.max_requests IS NOT NULL THEN
    IF p_request_kind = 'execution'
      AND v_requests_used + 1 >
        v_policy.max_requests - v_policy.reserve_test_requests - v_policy.reserve_close_requests
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_execution_request_limit');
    ELSIF p_request_kind = 'test'
      AND (v_test_requests_used + 1 > v_policy.reserve_test_requests
        OR v_requests_used + 1 > v_policy.max_requests)
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_test_request_reserve_exhausted');
    ELSIF p_request_kind = 'closure'
      AND (v_close_requests_used + 1 > v_policy.reserve_close_requests
        OR v_requests_used + 1 > v_policy.max_requests)
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_closure_request_reserve_exhausted');
    END IF;
  END IF;

  IF v_policy.max_total_tokens IS NOT NULL THEN
    IF p_request_kind = 'execution'
      AND v_tokens_used + p_estimated_tokens >
        v_policy.max_total_tokens - v_policy.reserve_test_tokens - v_policy.reserve_close_tokens
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_execution_token_limit');
    ELSIF p_request_kind = 'test'
      AND (v_test_tokens_used + p_estimated_tokens > v_policy.reserve_test_tokens
        OR v_tokens_used + p_estimated_tokens > v_policy.max_total_tokens)
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_test_token_reserve_exhausted');
    ELSIF p_request_kind = 'closure'
      AND (v_close_tokens_used + p_estimated_tokens > v_policy.reserve_close_tokens
        OR v_tokens_used + p_estimated_tokens > v_policy.max_total_tokens)
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_closure_token_reserve_exhausted');
    END IF;
  END IF;

  IF v_policy.max_cost_amount IS NOT NULL THEN
    IF p_request_kind = 'execution'
      AND v_cost_used + p_estimated_cost_amount >
        v_policy.max_cost_amount - v_policy.reserve_test_cost_amount - v_policy.reserve_close_cost_amount
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_execution_cost_limit');
    ELSIF p_request_kind = 'test'
      AND (v_test_cost_used + p_estimated_cost_amount > v_policy.reserve_test_cost_amount
        OR v_cost_used + p_estimated_cost_amount > v_policy.max_cost_amount)
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_test_cost_reserve_exhausted');
    ELSIF p_request_kind = 'closure'
      AND (v_close_cost_used + p_estimated_cost_amount > v_policy.reserve_close_cost_amount
        OR v_cost_used + p_estimated_cost_amount > v_policy.max_cost_amount)
    THEN
      RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_closure_cost_reserve_exhausted');
    END IF;
  END IF;

  INSERT INTO aria_internal.mission_budget_reservations_v1 (
    reservation_key, mission_id, policy_id, request_kind,
    estimated_tokens, estimated_cost_amount, currency_code
  ) VALUES (
    p_reservation_key, p_mission_id, v_policy.policy_id, p_request_kind,
    p_estimated_tokens, p_estimated_cost_amount, p_currency_code
  ) ON CONFLICT (reservation_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'mission_budget_reservation_key_already_used');
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'reservation_key', p_reservation_key,
    'policy_id', v_policy.policy_id,
    'request_kind', p_request_kind
  );
END;
$function$;

CREATE OR REPLACE FUNCTION aria_internal.mission_budget_settle_request_v1(
  p_reservation_key text,
  p_outcome text,
  p_actual_tokens bigint DEFAULT NULL,
  p_actual_cost_amount numeric DEFAULT NULL,
  p_currency_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy_id uuid;
  v_policy aria_internal.mission_budget_policies_v1%ROWTYPE;
  v_reservation aria_internal.mission_budget_reservations_v1%ROWTYPE;
  v_requests_used bigint := 0;
  v_execution_requests_used bigint := 0;
  v_test_requests_used bigint := 0;
  v_close_requests_used bigint := 0;
  v_tokens_used numeric := 0;
  v_execution_tokens_used numeric := 0;
  v_test_tokens_used numeric := 0;
  v_close_tokens_used numeric := 0;
  v_cost_used numeric := 0;
  v_execution_cost_used numeric := 0;
  v_test_cost_used numeric := 0;
  v_close_cost_used numeric := 0;
  v_overrun boolean := false;
BEGIN
  IF p_outcome IS NULL
    OR p_outcome NOT IN ('succeeded', 'failed', 'unknown', 'released')
    OR p_actual_tokens < 0
    OR p_actual_cost_amount < 0
    OR ((p_actual_cost_amount IS NULL) <> (p_currency_code IS NULL))
    OR (p_currency_code IS NOT NULL AND p_currency_code !~ '^[A-Z]{3}$')
  THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'invalid_budget_settlement_input');
  END IF;

  SELECT policy_id INTO v_policy_id
  FROM aria_internal.mission_budget_reservations_v1
  WHERE reservation_key = p_reservation_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'mission_budget_reservation_not_found');
  END IF;

  SELECT * INTO v_policy
  FROM aria_internal.mission_budget_policies_v1
  WHERE policy_id = v_policy_id
  FOR UPDATE;

  SELECT * INTO v_reservation
  FROM aria_internal.mission_budget_reservations_v1
  WHERE reservation_key = p_reservation_key
  FOR UPDATE;

  IF v_reservation.status <> 'reserved' THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'mission_budget_reservation_not_open');
  END IF;

  IF v_policy.max_cost_amount IS NOT NULL
    AND p_actual_cost_amount IS NOT NULL
    AND p_currency_code <> v_policy.currency_code
  THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'mission_budget_currency_mismatch');
  END IF;

  IF p_outcome = 'released'
    AND (p_actual_tokens IS NOT NULL OR p_actual_cost_amount IS NOT NULL)
  THEN
    RETURN jsonb_build_object('settled', false, 'reason', 'released_reservation_cannot_report_usage');
  END IF;

  UPDATE aria_internal.mission_budget_reservations_v1
  SET
    status = p_outcome,
    actual_tokens = p_actual_tokens,
    actual_cost_amount = p_actual_cost_amount,
    actual_currency_code = p_currency_code
  WHERE reservation_key = p_reservation_key;

  SELECT
    count(*) FILTER (WHERE status <> 'released')::bigint,
    count(*) FILTER (WHERE request_kind = 'execution' AND status <> 'released')::bigint,
    count(*) FILTER (WHERE request_kind = 'test' AND status <> 'released')::bigint,
    count(*) FILTER (WHERE request_kind = 'closure' AND status <> 'released')::bigint,
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE request_kind = 'execution' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE request_kind = 'test' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_tokens, estimated_tokens, 0))
      FILTER (WHERE request_kind = 'closure' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE request_kind = 'execution' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE request_kind = 'test' AND status <> 'released'), 0),
    COALESCE(sum(COALESCE(actual_cost_amount, estimated_cost_amount, 0))
      FILTER (WHERE request_kind = 'closure' AND status <> 'released'), 0)
  INTO
    v_requests_used, v_execution_requests_used, v_test_requests_used, v_close_requests_used,
    v_tokens_used, v_execution_tokens_used, v_test_tokens_used, v_close_tokens_used,
    v_cost_used, v_execution_cost_used, v_test_cost_used, v_close_cost_used
  FROM aria_internal.mission_budget_reservations_v1
  WHERE mission_id = v_reservation.mission_id AND policy_id = v_policy.policy_id;

  v_overrun :=
    (v_policy.max_requests IS NOT NULL AND v_requests_used > v_policy.max_requests)
    OR (v_policy.max_total_tokens IS NOT NULL AND v_tokens_used > v_policy.max_total_tokens)
    OR (v_policy.max_cost_amount IS NOT NULL AND v_cost_used > v_policy.max_cost_amount)
    OR (v_policy.max_requests IS NOT NULL AND
      (v_execution_requests_used > v_policy.max_requests
        - v_policy.reserve_test_requests - v_policy.reserve_close_requests
       OR v_test_requests_used > v_policy.reserve_test_requests
       OR v_close_requests_used > v_policy.reserve_close_requests))
    OR (v_policy.max_total_tokens IS NOT NULL AND
      (v_execution_tokens_used > v_policy.max_total_tokens
        - v_policy.reserve_test_tokens - v_policy.reserve_close_tokens
       OR v_test_tokens_used > v_policy.reserve_test_tokens
       OR v_close_tokens_used > v_policy.reserve_close_tokens))
    OR (v_policy.max_cost_amount IS NOT NULL AND
      (v_execution_cost_used > v_policy.max_cost_amount
        - v_policy.reserve_test_cost_amount - v_policy.reserve_close_cost_amount
       OR v_test_cost_used > v_policy.reserve_test_cost_amount
       OR v_close_cost_used > v_policy.reserve_close_cost_amount));

  RETURN jsonb_build_object(
    'settled', true,
    'reservation_key', p_reservation_key,
    'status', p_outcome,
    'within_budget', NOT v_overrun,
    'budget_overrun', v_overrun
  );
END;
$function$;

COMMENT ON TABLE aria_internal.mission_budget_policies_v1 IS
  'Versioned owner-approved per-mission ceilings. NULL means not configured/unknown, never unlimited. No policy is seeded; paid execution must be wired to the reservation gate before this schema provides runtime enforcement.';
COMMENT ON TABLE aria_internal.mission_budget_reservations_v1 IS
  'Append-only mission request budget ledger. Unknown outcomes retain their estimate; only explicit released status frees a reservation.';
COMMENT ON COLUMN aria_internal.mission_budget_policies_v1.reserve_test_requests IS
  'Absolute request count ring-fenced for verification/testing; no percentage or default amount is inferred.';
COMMENT ON COLUMN aria_internal.mission_budget_policies_v1.reserve_close_requests IS
  'Absolute request count ring-fenced for finalization/closure; no percentage or default amount is inferred.';
COMMENT ON COLUMN aria_internal.mission_budget_policies_v1.currency_code IS
  'Three-letter uppercase currency designator. Cost is enforceable only when a matching estimate is supplied from explicit pricing evidence.';
COMMENT ON FUNCTION aria_internal.mission_budget_reserve_request_v1(text, text, text, bigint, numeric, text) IS
  'Atomically reserves one mission request against an approved policy. Unknown token/cost estimates fail closed when the corresponding ceiling is configured. Must be called before provider execution by an integrated runtime.';
COMMENT ON FUNCTION aria_internal.mission_budget_settle_request_v1(text, text, bigint, numeric, text) IS
  'Finalizes a mission request once. Unknown outcomes retain the estimate. A released status is allowed only when the caller has reliable evidence that no upstream request was sent.';

ALTER TABLE aria_internal.mission_budget_policies_v1 ENABLE ROW LEVEL SECURITY;
ALTER TABLE aria_internal.mission_budget_reservations_v1 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE aria_internal.mission_budget_policies_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE aria_internal.mission_budget_reservations_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE aria_internal.mission_budget_policies_v1 TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE aria_internal.mission_budget_reservations_v1 TO service_role;

REVOKE ALL ON FUNCTION aria_internal.mission_budget_reserve_request_v1(text, text, text, bigint, numeric, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION aria_internal.mission_budget_settle_request_v1(text, text, bigint, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION aria_internal.mission_budget_reserve_request_v1(text, text, text, bigint, numeric, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION aria_internal.mission_budget_settle_request_v1(text, text, bigint, numeric, text)
  TO service_role;

COMMIT;
