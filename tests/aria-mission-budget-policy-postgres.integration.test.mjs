import assert from "node:assert/strict";

const connectionString = String(process.env.ARIA_OPTIMA_PG_INTEGRATION_URL || "").trim();
if (!connectionString) {
  console.log("SKIP ARIA Optima mission budget PostgreSQL integration: URL not configured");
  process.exit(0);
}
const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString });
const concurrentClient = new pg.Client({ connectionString });
const migration = await (await import("node:fs/promises")).readFile(
  new URL("../supabase/migrations/20261126044200_aria_mission_budget_policy_v1.sql", import.meta.url),
  "utf8",
);

const reserve = async (db, missionId, key, kind = "execution", tokens = null, cost = null, currency = null) => {
  const result = await db.query("SELECT aria_internal.mission_budget_reserve_request_v1($1,$2,$3,$4,$5,$6) AS result", [missionId,key,kind,tokens,cost,currency]);
  return result.rows[0].result;
};
const settle = async (db, key, outcome, tokens = null, cost = null, currency = null, releaseEvidence = null) => {
  const result = await db.query("SELECT aria_internal.mission_budget_settle_request_v1($1,$2,$3,$4,$5,$6) AS result", [key,outcome,tokens,cost,currency,releaseEvidence]);
  return result.rows[0].result;
};
const createMission = async (db,id) => {
  await db.query("INSERT INTO aria_internal.mission_state(mission_id,goal) VALUES ($1,$2)", [id,"synthetic integration mission "+id]);
};
const createApprovedPolicy = async (db,{
  missionId, policyVersion=1, maxRequests=null, maxTokens=null, maxCost=null, currency=null,
  testRequests=0, closeRequests=0, testTokens=0, closeTokens=0, testCost=0, closeCost=0,
}) => {
  const inserted = await db.query(
    "INSERT INTO aria_internal.mission_budget_policies_v1 (mission_id,policy_version,max_requests,max_total_tokens,max_cost_amount,currency_code,reserve_test_requests,reserve_close_requests,reserve_test_tokens,reserve_close_tokens,reserve_test_cost_amount,reserve_close_cost_amount,approval_ref,approved_by,approved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,clock_timestamp()) RETURNING policy_id",
    [missionId,policyVersion,maxRequests,maxTokens,maxCost,currency,testRequests,closeRequests,testTokens,closeTokens,testCost,closeCost,"synthetic-approval-"+missionId+"-v"+policyVersion,"integration-test-owner"],
  );
  const policyId=inserted.rows[0].policy_id;
  await db.query("UPDATE aria_internal.mission_budget_policies_v1 SET status='approved' WHERE policy_id=$1",[policyId]);
  return policyId;
};

try {
  await client.connect();
  await concurrentClient.connect();
  for (const role of ["anon","authenticated","service_role"]) {
    await client.query("DO $$ BEGIN CREATE ROLE "+role+" NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
  }
  await client.query("DROP SCHEMA IF EXISTS aria_internal CASCADE");
  await client.query("CREATE SCHEMA aria_internal");
  await client.query("CREATE TABLE aria_internal.mission_state (mission_id text PRIMARY KEY,goal text NOT NULL,status text NOT NULL DEFAULT 'queued',checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb,metadata jsonb NOT NULL DEFAULT '{}'::jsonb)");

  for (const id of ["mission-missing","mission-draft","mission-main","mission-release","mission-unknown","mission-revoke","mission-race","mission-version-usage"]) {
    await createMission(client,id);
  }
  await client.query(migration);
  await client.query(migration);

  assert.deepEqual(await reserve(client,"mission-missing","missing-001","execution",10),{allowed:false,reason:"mission_budget_policy_missing"});
  await client.query("INSERT INTO aria_internal.mission_budget_policies_v1(mission_id,policy_version,max_requests,approval_ref) VALUES ('mission-draft',1,2,'draft-only')");
  assert.deepEqual(await reserve(client,"mission-draft","draft-001","execution",10),{allowed:false,reason:"mission_budget_policy_not_approved"});
  await assert.rejects(
    client.query("INSERT INTO aria_internal.mission_budget_policies_v1(mission_id,policy_version,status,max_cost_amount,approval_ref,approved_by,approved_at) VALUES ('mission-draft',2,'draft',5,'bad-currency','test-owner',clock_timestamp())"),
    /mission_budget_policy_cost_currency/,
  );
  await assert.rejects(
    client.query("INSERT INTO aria_internal.mission_budget_policies_v1(mission_id,policy_version,status,max_requests,approval_ref,approved_by,approved_at) VALUES ('mission-draft',3,'approved',5,'direct-approval','test-owner',clock_timestamp())"),
    /mission budget policies must begin as draft/,
  );
  assert.deepEqual(await reserve(client,"mission-missing","invalid-kind-001",null,1),{allowed:false,reason:"invalid_budget_reservation_input"});
  assert.deepEqual(await settle(client,"not-found",null),{settled:false,reason:"invalid_budget_settlement_input"});

  await createApprovedPolicy(client,{
    missionId:"mission-main",maxRequests:5,maxTokens:1000,maxCost:"10.00000000",currency:"USD",
    testRequests:1,closeRequests:1,testTokens:100,closeTokens:100,testCost:"0.50000000",closeCost:"0.50000000",
  });
  assert.deepEqual(await reserve(client,"mission-main","unknown-tokens-001","execution",null,"1.00","USD"),{allowed:false,reason:"mission_budget_token_estimate_unknown"});
  assert.deepEqual(await reserve(client,"mission-main","unknown-cost-001","execution",10),{allowed:false,reason:"mission_budget_cost_estimate_unknown"});
  assert.deepEqual(await reserve(client,"mission-main","bad-currency-001","execution",10,"1.00","EUR"),{allowed:false,reason:"mission_budget_currency_mismatch"});

  for (let i=1;i<=3;i++) assert.equal((await reserve(client,"mission-main","execution-00"+i,"execution",200,"2.00","USD")).allowed,true);
  assert.deepEqual(await reserve(client,"mission-main","execution-004","execution",1,"0.01","USD"),{allowed:false,reason:"mission_budget_execution_request_limit"});
  assert.equal((await reserve(client,"mission-main","test-001","test",100,"0.50","USD")).allowed,true);
  assert.deepEqual(await reserve(client,"mission-main","test-002","test",1,"0.01","USD"),{allowed:false,reason:"mission_budget_test_request_reserve_exhausted"});
  assert.equal((await reserve(client,"mission-main","closure-001","closure",100,"0.50","USD")).allowed,true);
  assert.deepEqual(await reserve(client,"mission-main","closure-002","closure",1,"0.01","USD"),{allowed:false,reason:"mission_budget_closure_request_reserve_exhausted"});
  assert.deepEqual(await reserve(client,"mission-main","execution-001","execution",1,"0.01","USD"),{allowed:false,reason:"mission_budget_reservation_key_already_used"});

  const executionSettlement=await settle(client,"execution-001","succeeded",250,"2.20","USD");
  assert.equal(executionSettlement.settled,true);
  assert.equal(executionSettlement.within_budget,true);
  const testOverrun=await settle(client,"test-001","succeeded",120,"0.70","USD");
  assert.equal(testOverrun.settled,true);
  assert.equal(testOverrun.within_budget,false);
  assert.equal(testOverrun.budget_overrun,true);
  assert.deepEqual(await settle(client,"test-001","succeeded",120,"0.70","USD"),{settled:false,reason:"mission_budget_reservation_not_open"});

  await createApprovedPolicy(client,{missionId:"mission-release",maxRequests:1});
  assert.equal((await reserve(client,"mission-release","release-001","execution")).allowed,true);
  assert.deepEqual(await settle(client,"release-001","released"),{settled:false,reason:"invalid_budget_settlement_input"});
  assert.deepEqual(await settle(client,"release-001","released",1,null,null,"ci:no-upstream-request"),{settled:false,reason:"released_reservation_cannot_report_usage"});
  assert.equal((await settle(client,"release-001","released",null,null,null,"ci:no-upstream-request")).settled,true);
  assert.equal((await reserve(client,"mission-release","release-002","execution")).allowed,true);

  await createApprovedPolicy(client,{missionId:"mission-unknown",maxTokens:500});
  assert.equal((await reserve(client,"mission-unknown","unknown-outcome-001","execution",300)).allowed,true);
  assert.equal((await settle(client,"unknown-outcome-001","unknown")).settled,true);
  assert.deepEqual(await reserve(client,"mission-unknown","unknown-outcome-002","execution",250),{allowed:false,reason:"mission_budget_execution_token_limit"});

  const policyRow=await client.query("SELECT policy_id FROM aria_internal.mission_budget_policies_v1 WHERE mission_id='mission-main' AND status='approved'");
  await assert.rejects(client.query("UPDATE aria_internal.mission_budget_policies_v1 SET max_requests=99 WHERE policy_id=$1",[policyRow.rows[0].policy_id]),/approved mission budget policies are immutable/);

  await createApprovedPolicy(client,{missionId:"mission-revoke",maxRequests:3});
  const revokeRow=await client.query("SELECT policy_id FROM aria_internal.mission_budget_policies_v1 WHERE mission_id='mission-revoke' AND status='approved'");
  await client.query("UPDATE aria_internal.mission_budget_policies_v1 SET status='revoked' WHERE policy_id=$1",[revokeRow.rows[0].policy_id]);
  assert.deepEqual(await reserve(client,"mission-revoke","revoked-001","execution"),{allowed:false,reason:"mission_budget_policy_revoked"});
  await createApprovedPolicy(client,{missionId:"mission-revoke",policyVersion:2,maxRequests:2});
  assert.equal((await reserve(client,"mission-revoke","revoked-002","execution")).allowed,true);

  await createApprovedPolicy(client,{missionId:"mission-version-usage",maxRequests:3});
  assert.equal((await reserve(client,"mission-version-usage","version-001","execution")).allowed,true);
  const oldPolicy=await client.query("SELECT policy_id FROM aria_internal.mission_budget_policies_v1 WHERE mission_id='mission-version-usage' AND status='approved'");
  await client.query("UPDATE aria_internal.mission_budget_policies_v1 SET status='revoked' WHERE policy_id=$1",[oldPolicy.rows[0].policy_id]);
  await createApprovedPolicy(client,{missionId:"mission-version-usage",policyVersion:2,maxRequests:1});
  assert.deepEqual(await reserve(client,"mission-version-usage","version-002","execution"),{allowed:false,reason:"mission_budget_execution_request_limit"});

  await createApprovedPolicy(client,{missionId:"mission-race",maxRequests:1});
  const concurrent=await Promise.all([
    reserve(client,"mission-race","race-001","execution"),
    reserve(concurrentClient,"mission-race","race-002","execution"),
  ]);
  assert.equal(concurrent.filter(x=>x.allowed).length,1);
  assert.equal(concurrent.filter(x=>x.reason==="mission_budget_execution_request_limit").length,1);

  const security=await client.query("SELECT (SELECT relrowsecurity FROM pg_class WHERE oid='aria_internal.mission_budget_policies_v1'::regclass) AS policy_rls,(SELECT relrowsecurity FROM pg_class WHERE oid='aria_internal.mission_budget_reservations_v1'::regclass) AS reservation_rls,has_table_privilege('anon','aria_internal.mission_budget_policies_v1','SELECT') AS anon_policy_read,has_table_privilege('authenticated','aria_internal.mission_budget_reservations_v1','SELECT') AS auth_reservation_read,has_table_privilege('service_role','aria_internal.mission_budget_policies_v1','SELECT') AS service_policy_read,has_function_privilege('anon','aria_internal.mission_budget_reserve_request_v1(text,text,text,bigint,numeric,text)','EXECUTE') AS anon_reserve_exec,has_function_privilege('authenticated','aria_internal.mission_budget_settle_request_v1(text,text,bigint,numeric,text,text)','EXECUTE') AS auth_settle_exec,has_function_privilege('service_role','aria_internal.mission_budget_reserve_request_v1(text,text,text,bigint,numeric,text)','EXECUTE') AS service_reserve_exec");
  const sr=security.rows[0];
  assert.equal(sr.policy_rls,true); assert.equal(sr.reservation_rls,true);
  assert.equal(sr.anon_policy_read,false); assert.equal(sr.auth_reservation_read,false);
  assert.equal(sr.service_policy_read,true); assert.equal(sr.anon_reserve_exec,false);
  assert.equal(sr.auth_settle_exec,false); assert.equal(sr.service_reserve_exec,true);

  console.log("ARIA_OPTIMA_MISSION_BUDGET_MIGRATION_POSTGRES=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_FAIL_CLOSED_APPROVAL_GATE=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_REQUEST_TOKEN_COST_CAPS=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_TEST_CLOSURE_RESERVES=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_UNKNOWN_AND_RELEASE_ACCOUNTING=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_IMMUTABLE_VERSIONED_POLICY=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_CONCURRENT_RESERVATION=PASS");
  console.log("ARIA_OPTIMA_MISSION_BUDGET_RLS_GRANTS=PASS");
} finally {
  await concurrentClient.end().catch(()=>{});
  await client.end().catch(()=>{});
}
