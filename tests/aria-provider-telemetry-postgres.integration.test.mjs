import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const connectionString = String(process.env.ARIA_OPTIMA_PG_INTEGRATION_URL || "").trim();
if (!connectionString) {
  console.log("SKIP ARIA Optima provider telemetry PostgreSQL integration: URL not configured");
  process.exit(0);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString });
const migration = await readFile(
  new URL("../supabase/migrations/20261125190000_aria_provider_usage_observability_v1.sql", import.meta.url),
  "utf8",
);

try {
  await client.connect();
  await client.query(String.raw`DO $$ BEGIN
    CREATE ROLE anon NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await client.query(String.raw`DO $$ BEGIN
    CREATE ROLE authenticated NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);
  await client.query(String.raw`DO $$ BEGIN
    CREATE ROLE service_role NOLOGIN;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;`);

  await client.query("DROP SCHEMA IF EXISTS aria_internal CASCADE");
  await client.query("CREATE SCHEMA aria_internal");
  await client.query(String.raw`
    CREATE TABLE aria_internal.quota_registry (
      quota_id text PRIMARY KEY,
      provider_id text NOT NULL,
      account_id text NOT NULL,
      model_id text,
      status text NOT NULL,
      limits_requests bigint,
      usage_requests bigint,
      limits_tokens_input bigint,
      limits_tokens_output bigint,
      limits_tokens_total bigint,
      usage_tokens_input bigint,
      usage_tokens_output bigint,
      usage_tokens_total bigint,
      limits_period text,
      usage_period_start timestamptz,
      usage_period_end timestamptz,
      source_type text,
      evidence_ref text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      notes text,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE aria_internal.quota_request_reservations_v1 (
      reservation_key text PRIMARY KEY,
      provider_id text NOT NULL,
      account_id text NOT NULL,
      model_id text NOT NULL,
      model_quota_id text NOT NULL,
      account_quota_id text,
      model_period_start timestamptz,
      account_period_start timestamptz,
      status text NOT NULL DEFAULT 'reserved',
      provider_status integer,
      prompt_tokens bigint,
      completion_tokens bigint,
      total_tokens bigint,
      provider_response_id text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      settled_at timestamptz
    );
    CREATE FUNCTION aria_internal.quota_reserve_model_request_v1(
      p_reservation_key text, p_provider_id text, p_account_id text, p_model_id text,
      p_provider_used bigint DEFAULT NULL, p_provider_limit bigint DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
    DECLARE v_model text; v_account text;
    BEGIN
      SELECT quota_id INTO v_model FROM aria_internal.quota_registry
       WHERE provider_id=p_provider_id AND account_id=p_account_id AND model_id=p_model_id AND status='available';
      IF v_model IS NULL THEN RETURN jsonb_build_object('allowed',false,'reason','model_quota_unavailable'); END IF;
      IF p_provider_id='openrouter' AND right(COALESCE(p_model_id,''),5)=':free' THEN
        SELECT quota_id INTO v_account FROM aria_internal.quota_registry
         WHERE provider_id=p_provider_id AND account_id=p_account_id AND model_id IS NULL AND status='available';
        IF v_account IS NULL OR p_provider_used IS NULL OR p_provider_limit IS NULL
           OR p_provider_used < 0 OR p_provider_limit <= 0 OR p_provider_used >= p_provider_limit THEN
          RETURN jsonb_build_object('allowed',false,'reason','provider_free_daily_quota_unverified');
        END IF;
      END IF;
      INSERT INTO aria_internal.quota_request_reservations_v1 (
        reservation_key,provider_id,account_id,model_id,model_quota_id,account_quota_id,status
      ) VALUES (p_reservation_key,p_provider_id,p_account_id,p_model_id,v_model,v_account,'reserved')
      ON CONFLICT (reservation_key) DO NOTHING;
      IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','duplicate_reservation_key'); END IF;
      RETURN jsonb_build_object('allowed',true,'reservation_key',p_reservation_key);
    END; $fn$;
    CREATE FUNCTION aria_internal.quota_settle_model_request_v1(
      p_reservation_key text, p_outcome text, p_provider_status integer DEFAULT NULL,
      p_prompt_tokens bigint DEFAULT NULL, p_completion_tokens bigint DEFAULT NULL,
      p_total_tokens bigint DEFAULT NULL, p_provider_response_id text DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
    BEGIN
      UPDATE aria_internal.quota_request_reservations_v1
         SET status=p_outcome,provider_status=p_provider_status,
             prompt_tokens=p_prompt_tokens,completion_tokens=p_completion_tokens,
             total_tokens=p_total_tokens,provider_response_id=p_provider_response_id,
             settled_at=clock_timestamp()
       WHERE reservation_key=p_reservation_key AND status='reserved';
      IF NOT FOUND THEN RETURN jsonb_build_object('settled',false,'reason','reservation_not_open'); END IF;
      RETURN jsonb_build_object('settled',true,'reservation_key',p_reservation_key,'status',p_outcome);
    END; $fn$;
    INSERT INTO aria_internal.quota_registry (
      quota_id,provider_id,account_id,model_id,status,limits_requests,usage_requests,limits_period,metadata
    ) VALUES
      ('quota-openrouter-account','openrouter','acct_openrouter_primary',NULL,'available',50,0,'day','{}'::jsonb),
      ('quota-openrouter-free-model','openrouter','acct_openrouter_primary','nvidia/nemotron-3.5-lightning:free','available',NULL,0,NULL,'{}'::jsonb),
      ('quota-google-direct','google','acct-google-direct','gemini-direct','available',NULL,0,NULL,'{}'::jsonb);
  `);

  await client.query(migration);
  await client.query(migration); // migration must be idempotent

  const noSnapshot = await client.query(
    "SELECT aria_internal.quota_reserve_model_request_v2($1,$2,$3,$4,NULL,NULL,NULL) AS result",
    ["reservation-no-snapshot","openrouter","acct_openrouter_primary","nvidia/nemotron-3.5-lightning:free"],
  );
  assert.deepEqual(noSnapshot.rows[0].result,{allowed:false,reason:"provider_free_daily_quota_unverified"});

  const reserve = await client.query(
    "SELECT aria_internal.quota_reserve_model_request_v2($1,$2,$3,$4,$5,$6,$7) AS result",
    ["reservation-free-001","openrouter","acct_openrouter_primary","nvidia/nemotron-3.5-lightning:free",12,50,38],
  );
  assert.deepEqual(reserve.rows[0].result,{allowed:true,reservation_key:"reservation-free-001"});

  const snapshot = await client.query(
    "SELECT observed_remaining_requests,quota_observed_at,quota_observation_source FROM aria_internal.quota_registry WHERE quota_id='quota-openrouter-account'",
  );
  assert.equal(Number(snapshot.rows[0].observed_remaining_requests),38);
  assert.ok(snapshot.rows[0].quota_observed_at instanceof Date);
  assert.equal(snapshot.rows[0].quota_observation_source,"https://openrouter.ai/api/v1/key");

  const settle = await client.query(
    "SELECT aria_internal.quota_settle_model_request_v2($1,$2,$3,$4,$5,$6,$7,$8) AS result",
    ["reservation-free-001","succeeded",200,120,30,150,"provider-response-1",72],
  );
  assert.equal(settle.rows[0].result.settled,true);

  const repeatSettle = await client.query(
    "SELECT aria_internal.quota_settle_model_request_v2($1,$2,$3,$4,$5,$6,$7,$8) AS result",
    ["reservation-free-001","succeeded",200,120,30,150,"provider-response-1",72],
  );
  assert.equal(repeatSettle.rows[0].result.settled,false);

  const invalidCached = await client.query(
    "SELECT aria_internal.quota_settle_model_request_v2($1,$2,$3,$4,$5,$6,$7,$8) AS result",
    ["reservation-free-001","succeeded",200,1,1,2,null,-1],
  );
  assert.deepEqual(invalidCached.rows[0].result,{settled:false,reason:"invalid_cached_input_tokens"});

  const directReserve = await client.query(
    "SELECT aria_internal.quota_reserve_model_request_v2($1,$2,$3,$4,NULL,NULL,NULL) AS result",
    ["reservation-google-001","google","acct-google-direct","gemini-direct"],
  );
  assert.deepEqual(directReserve.rows[0].result,{allowed:true,reservation_key:"reservation-google-001"});
  await client.query(
    "SELECT aria_internal.quota_settle_model_request_v2($1,$2,$3,$4,$5,$6,$7,$8)",
    ["reservation-google-001","failed",429,4,2,6,null,null],
  );

  const telemetry = await client.query(`
    SELECT requests_reserved,requests_succeeded,requests_failed,provider_http_429,
           prompt_tokens_reported_sum,completion_tokens_reported_sum,total_tokens_reported_sum,
           cached_input_tokens_reported_sum,cached_input_token_observations,
           avg_reservation_to_settlement_ms,last_success_at
      FROM aria_internal.provider_execution_observability_v1
     WHERE provider_id='openrouter' AND account_id='acct_openrouter_primary'
       AND model_id='nvidia/nemotron-3.5-lightning:free'
  `);
  const row=telemetry.rows[0];
  assert.equal(Number(row.requests_reserved),1);
  assert.equal(Number(row.requests_succeeded),1);
  assert.equal(Number(row.requests_failed),0);
  assert.equal(Number(row.prompt_tokens_reported_sum),120);
  assert.equal(Number(row.completion_tokens_reported_sum),30);
  assert.equal(Number(row.total_tokens_reported_sum),150);
  assert.equal(Number(row.cached_input_tokens_reported_sum),72);
  assert.equal(Number(row.cached_input_token_observations),1);
  assert.ok(Number(row.avg_reservation_to_settlement_ms)>=0);
  assert.ok(row.last_success_at instanceof Date);

  const google = await client.query(`
    SELECT requests_failed,provider_http_429,cached_input_tokens_reported_sum,cached_input_token_observations
      FROM aria_internal.provider_execution_observability_v1
     WHERE provider_id='google' AND account_id='acct-google-direct' AND model_id='gemini-direct'
  `);
  assert.equal(Number(google.rows[0].requests_failed),1);
  assert.equal(Number(google.rows[0].provider_http_429),1);
  assert.equal(Number(google.rows[0].cached_input_tokens_reported_sum||0),0);
  assert.equal(Number(google.rows[0].cached_input_token_observations),0);

  const capacity = await client.query(`
    SELECT remaining_requests_derived,provider_reported_remaining_requests,
           quota_observed_at,quota_observation_source,quota_window_end
      FROM aria_internal.provider_quota_capacity_v1
     WHERE quota_id='quota-openrouter-account'
  `);
  assert.equal(Number(capacity.rows[0].remaining_requests_derived),50);
  assert.equal(Number(capacity.rows[0].provider_reported_remaining_requests),38);
  assert.equal(capacity.rows[0].quota_observation_source,"https://openrouter.ai/api/v1/key");
  assert.equal(capacity.rows[0].quota_window_end,null);

  const grants = await client.query(`
    SELECT
      has_table_privilege('anon','aria_internal.provider_execution_observability_v1','SELECT') AS anon_select,
      has_table_privilege('authenticated','aria_internal.provider_quota_capacity_v1','SELECT') AS authenticated_select,
      has_table_privilege('service_role','aria_internal.provider_execution_observability_v1','SELECT') AS service_select,
      has_function_privilege('anon','aria_internal.quota_reserve_model_request_v2(text,text,text,text,bigint,bigint,bigint)','EXECUTE') AS anon_execute,
      has_function_privilege('service_role','aria_internal.quota_reserve_model_request_v2(text,text,text,text,bigint,bigint,bigint)','EXECUTE') AS service_execute
  `);
  assert.equal(grants.rows[0].anon_select,false);
  assert.equal(grants.rows[0].authenticated_select,false);
  assert.equal(grants.rows[0].service_select,true);
  assert.equal(grants.rows[0].anon_execute,false);
  assert.equal(grants.rows[0].service_execute,true);

  console.log("ARIA_OPTIMA_PROVIDER_TELEMETRY_MIGRATION_POSTGRES=PASS");
  console.log("ARIA_OPTIMA_PROVIDER_QUOTA_SNAPSHOT_RUNTIME_V2=PASS");
  console.log("ARIA_OPTIMA_PROVIDER_CACHED_TOKEN_SETTLEMENT_V2=PASS");
  console.log("ARIA_OPTIMA_PROVIDER_EXECUTION_OBSERVABILITY_VIEW=PASS");
  console.log("ARIA_OPTIMA_PROVIDER_QUOTA_CAPACITY_VIEW=PASS");
  console.log("ARIA_OPTIMA_PROVIDER_TELEMETRY_RLS_GRANTS=PASS");
} finally {
  await client.end().catch(() => {});
}
