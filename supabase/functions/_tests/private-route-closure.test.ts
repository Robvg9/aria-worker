import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { canEnterGeneralIndex, parseRetrievalQuery } from "../_shared/private-route-contract.ts";

Deno.test("general retrieval requires exactly one bounded query field", () => {
  assertEquals(parseRetrievalQuery({ query: "   useful query  " }), "useful query");
  assertEquals(parseRetrievalQuery({ query: "" }), null);
  assertEquals(parseRetrievalQuery({ query: "x".repeat(2001) }), null);
  assertEquals(parseRetrievalQuery({ query: "safe", private: "leak" }), null);
  assertEquals(parseRetrievalQuery(null), null);
  assertEquals(parseRetrievalQuery(["not", "an", "object"]), null);
});

Deno.test("only explicit general classification can enter the shared index", () => {
  assertEquals(canEnterGeneralIndex({ privacy_class: "general" }), true);
  assertEquals(canEnterGeneralIndex({ privacy_class: "private" }), false);
  assertEquals(canEnterGeneralIndex({}), false);
  assertEquals(canEnterGeneralIndex(null), false);
  assertEquals(canEnterGeneralIndex({ privacy_class: "unclassified" }), false);
});

Deno.test("migration closes client RPC access and redacts saved retrieval queries", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261014162000_aria_encrypt_step5_route_lockdown.sql");
  assertStringIncludes(sql, "REVOKE EXECUTE ON FUNCTION public.cb_search_chunks(text, integer) FROM PUBLIC, anon, authenticated");
  assertStringIncludes(sql, "REVOKE EXECUTE ON FUNCTION aria_memory.learning_context_for_goal(text, integer) FROM PUBLIC, anon, authenticated");
  assertStringIncludes(sql, "GRANT EXECUTE ON FUNCTION aria_memory.learning_context_for_goal(text, integer) TO service_role;");
  assertStringIncludes(sql, "[REDACTED: query content not retained]");
  assertStringIncludes(sql, "aria_encrypt_general_memory_guard");
  assertStringIncludes(sql, "aria_encrypt_general_document_guard");
  assertStringIncludes(sql, "aria_encrypt_general_chunk_guard");
  assertStringIncludes(sql, "aria_encrypt_general_candidate_guard");
  assertStringIncludes(sql, "m.metadata->>'privacy_class'='general'");
  const unembeddedStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.list_unembedded");
  const unembeddedEnd = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.search_hybrid");
  assertEquals(unembeddedStart >= 0, true);
  assertEquals(unembeddedEnd > unembeddedStart, true);
  assertStringIncludes(sql.slice(unembeddedStart, unembeddedEnd), "m.metadata->>'privacy_class' = 'general'");
  const captureStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.capture_mission_outcome()");
  const reflectStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.reflect_mission_outcome");
  const compileStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.compile_skill_for_goal");
  const promoteStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.promote_failure_learning");
  const preflightStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.learning_preflight");
  const consolidateStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.consolidate_duplicates");
  const memoryGuardStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.aria_encrypt_require_general_memory()");
  assertEquals(captureStart >= 0, true);
  assertEquals(captureStart < reflectStart && reflectStart < compileStart && compileStart < promoteStart &&
    promoteStart < preflightStart && preflightStart < consolidateStart && consolidateStart < memoryGuardStart, true);
  assertStringIncludes(sql.slice(captureStart, reflectStart), "if coalesce(new.metadata->>'privacy_class','') IS DISTINCT FROM 'general' then return new; end if;");
  assertStringIncludes(sql.slice(captureStart, reflectStart), "'privacy_class','general'");
  assertStringIncludes(sql.slice(reflectStart, compileStart), "m.metadata->>'privacy_class'='general'");
  assertStringIncludes(sql.slice(reflectStart, compileStart), "'privacy_class','general'");
  assertStringIncludes(sql.slice(compileStart, promoteStart), "metadata->>'privacy_class'='general'");
  assertStringIncludes(sql.slice(compileStart, promoteStart), "'privacy_class','general'");
  assertStringIncludes(sql.slice(promoteStart, preflightStart), "metadata->>'privacy_class'='general'");
  assertStringIncludes(sql.slice(promoteStart, preflightStart), "'privacy_class','general'");
  assertStringIncludes(sql.slice(preflightStart, consolidateStart), "m.metadata->>'privacy_class'='general'");
  assertStringIncludes(sql.slice(consolidateStart, memoryGuardStart), "b.metadata->>'privacy_class' = 'general'");
});

Deno.test("retrieval source uses an explicit general-only query and does not echo or return metadata blobs", async () => {
  const source = await Deno.readTextFile("supabase/functions/aria-context-retrieval-v1/index.ts");
  assertStringIncludes(source, '.filter("cb_documents.metadata->>privacy_class", "eq", "general")');
  assertStringIncludes(source, "canEnterGeneralIndex(row.cb_documents?.metadata)");
  assertStringIncludes(source, 'query_text: "[REDACTED]"');
  assertEquals(source.includes("return reply(200, { query,"), false);
  assertEquals(source.includes("metadata: item.row.metadata"), false);
  assertEquals(source.includes("detail: error.message"), false);
});


Deno.test("memory write gate fails closed and cannot persist unclassified candidate text", async () => {
  const source = await Deno.readTextFile("supabase/functions/aria-memory-write-gate-v1/index.ts");
  assertStringIncludes(source, "ARIA_MEMORY_PRIVACY_GATE_CLOSED");
  assertStringIncludes(source, "privacy_classification_unavailable");
  assertStringIncludes(source, "return respond(503");
  assertEquals(source.includes('.from("cb_memory_candidates")'), false);
  assertEquals(source.includes(".insert("), false);
  assertStringIncludes(source, "aria_memory_write");
});

Deno.test("aria-memory-v2 fails closed before search, remember, embedding, and maintenance actions", async () => {
  const source = await Deno.readTextFile("supabase/functions/aria-memory-v2/index.ts");
  const guardIndex = source.indexOf("if(['remember','search','embed_missing','maintenance'].includes(action))");
  const rememberHandlerIndex = source.indexOf("if(action==='remember')");
  const searchHandlerIndex = source.indexOf("if(action==='search')");
  const embedHandlerIndex = source.indexOf("if(action==='embed_missing')");
  const maintenanceHandlerIndex = source.indexOf("if(action==='maintenance')");
  assertEquals(guardIndex >= 0, true);
  assertEquals(rememberHandlerIndex >= 0, true);
  assertEquals(searchHandlerIndex >= 0, true);
  assertEquals(embedHandlerIndex >= 0, true);
  assertEquals(maintenanceHandlerIndex >= 0, true);
  assertEquals(guardIndex < rememberHandlerIndex, true);
  assertEquals(guardIndex < searchHandlerIndex, true);
  assertEquals(guardIndex < embedHandlerIndex, true);
  assertEquals(guardIndex < maintenanceHandlerIndex, true);
  assertStringIncludes(source, "ARIA_MEMORY_PRIVACY_GATE_CLOSED");
  assertStringIncludes(source, "privacy_classification_pending");
  assertStringIncludes(source, "temporarily_disabled_capabilities:['remember','search','embed_missing','maintenance']");
});

Deno.test("internal learning routes fail closed before reading mission evidence or writing memory", async () => {
  const v2 = await Deno.readTextFile("supabase/functions/aria-learning-v2/index.ts");
  const v3 = await Deno.readTextFile("supabase/functions/aria-learning-v3/index.ts");
  const consolidator = await Deno.readTextFile("supabase/functions/aria-learning-consolidator-v1/index.ts");

  assertStringIncludes(v2, "if(!(await auth(r)))return out({error:'unauthorized'},401);return out({error:'privacy_classification_pending',code:'ARIA_MEMORY_PRIVACY_GATE_CLOSED',retryable:true},503);");
  assertStringIncludes(v2, "const b=await r.json()");
  assertEquals(v2.indexOf("ARIA_MEMORY_PRIVACY_GATE_CLOSED") < v2.indexOf("const b=await r.json()"), true);
  assertEquals(v2.indexOf("ARIA_MEMORY_PRIVACY_GATE_CLOSED") < v2.indexOf("async function learnMission"), false);

  assertStringIncludes(v3, "if(!(await auth(r)))return out({error:'unauthorized'},401);return out({error:'privacy_classification_pending',code:'ARIA_MEMORY_PRIVACY_GATE_CLOSED',retryable:true},503);");
  assertStringIncludes(v3, "const b=await r.json()");
  assertEquals(v3.indexOf("ARIA_MEMORY_PRIVACY_GATE_CLOSED") < v3.indexOf("const b=await r.json()"), true);

  assertStringIncludes(consolidator, 'if(!t||!SECRET||!eq(t,SECRET))return json({error:"unauthorized"},401);return json({error:"privacy_classification_pending",code:"ARIA_MEMORY_PRIVACY_GATE_CLOSED",retryable:true},503);');
  assertStringIncludes(consolidator, '.from("mission_state")');
  assertEquals(consolidator.indexOf("ARIA_MEMORY_PRIVACY_GATE_CLOSED") < consolidator.indexOf('.from("mission_state")'), true);
});

Deno.test("internal mastery/preflight and scoped search require general classification", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261014162000_aria_encrypt_step5_route_lockdown.sql");
  assertEquals(/^\s*\$function\$\s*$/m.test(sql), false, "All copied PostgreSQL function bodies must be statement-terminated.");
  assertEquals(/(?:END;|RETURN [^;]+;)\s+\$function\$(?!;)/i.test(sql), false, "Inline function bodies must also end in a semicolon.");
  const failureStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_internal.capture_failure_mastery()");
  const enforceStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_internal.enforce_learning_preflight()");
  const validateStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_internal.validate_learning_preflight(");
  const verifyStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_internal.verify_learning_application(");
  const missionOutcomeStart = sql.indexOf("CREATE OR REPLACE FUNCTION aria_memory.capture_mission_outcome()");
  assertEquals(failureStart >= 0, true);
  assertEquals(failureStart < enforceStart && enforceStart < validateStart &&
    validateStart < verifyStart && verifyStart < missionOutcomeStart, true);

  const failure = sql.slice(failureStart, enforceStart);
  const enforce = sql.slice(enforceStart, validateStart);
  const validate = sql.slice(validateStart, verifyStart);
  const verify = sql.slice(verifyStart, missionOutcomeStart);
  assertStringIncludes(failure, "new.metadata->>'privacy_class','') IS DISTINCT FROM 'general'");
  assertStringIncludes(failure, "m.metadata->>'privacy_class'='general'");
  assertStringIncludes(failure, "'privacy_class','general'");
  assertStringIncludes(enforce, "m.metadata->>'privacy_class'='general'");
  assertStringIncludes(validate, "m.metadata->>'privacy_class'='general'");
  assertStringIncludes(verify, "m.metadata->>'privacy_class'='general'");

  const scopedStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.aria_memory_search_hybrid_text_scoped(");
  assertEquals(scopedStart >= 0, true);
  const scopedEnd = sql.indexOf("COMMIT;", scopedStart);
  assertEquals(scopedEnd > scopedStart, true);
  const scoped = sql.slice(scopedStart, scopedEnd);
  assertStringIncludes(scoped, "FROM aria_memory.search_hybrid_user_scoped");
  assertEquals(scoped.includes("FROM aria_memory.memory_items"), false);
});

Deno.test("internal learning table and legacy retrieval routes fail closed by classification", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261014233000_aria_encrypt_step5_learning_table_and_cb_search.sql");
  assertStringIncludes(sql, "ADD COLUMN IF NOT EXISTS privacy_class text NOT NULL DEFAULT 'unclassified'");
  assertStringIncludes(sql, "NEW.privacy_class IS DISTINCT FROM 'general'");
  assertStringIncludes(sql, "BEFORE INSERT OR UPDATE OF summary, evidence, privacy_class");
  assertStringIncludes(sql, "AND d.metadata->>'privacy_class' = 'general'");
  assertStringIncludes(sql, "REVOKE EXECUTE ON FUNCTION public.cb_search_chunks(text, integer)");
  assertStringIncludes(sql, "GRANT EXECUTE ON FUNCTION public.cb_search_chunks(text, integer)");

  const appApi = await Deno.readTextFile("supabase/functions/aria-app-api-v3/index.ts");
  assertStringIncludes(appApi, ".eq('metadata->>privacy_class','general').gte('confidence',.9)");
  const planner11 = await Deno.readTextFile("supabase/functions/aria-planner-v11/index.ts");
  assertStringIncludes(planner11, '.eq("metadata->>privacy_class","general").ilike("title","%verified multi-executor composition%")');

  for (const version of ["v7", "v8", "v9", "v10"]) {
    const source = await Deno.readTextFile("supabase/functions/aria-planner-" + version + "/index.ts");
    assertStringIncludes(source, '.eq("privacy_class","general").order("created_at"');
  }

  const gateway = await Deno.readTextFile("supabase/functions/aria-device-gateway/index.ts");
  assertStringIncludes(gateway, ".eq('metadata->>privacy_class','general').in('status',['succeeded','blocked','failed','timeout','cancelled'])");
  assertStringIncludes(gateway, "privacy_class:'general'");
  assertStringIncludes(gateway, ".eq('privacy_class','general').eq('reusable',true)");
  assertStringIncludes(gateway, ".eq('mission_id',m.mission_id).eq('privacy_class','general').limit(1)");

  for (const version of ["v6", "v7", "v8", "v9"]) {
    const supervisor = await Deno.readTextFile("supabase/functions/aria-autonomy-supervisor-" + version + "/index.ts");
    assertStringIncludes(supervisor, '.eq("metadata->>privacy_class","general").in("status"');
    assertStringIncludes(supervisor, 'privacy_class:"general"');
    assertStringIncludes(supervisor, '.eq("privacy_class","general").limit(1)');
  }
});

Deno.test("chunk search requires both parent and chunk general classification", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261014234000_aria_encrypt_step5_require_chunk_class.sql");
  assertStringIncludes(sql, "NEW.metadata, '{}'::jsonb)->>'privacy_class') IS DISTINCT FROM 'general'");
  assertStringIncludes(sql, "document_class IS DISTINCT FROM 'general'");
  assertStringIncludes(sql, "AND d.metadata->>'privacy_class' = 'general'");
  assertStringIncludes(sql, "AND c.metadata->>'privacy_class' = 'general'");
  assertStringIncludes(sql, "REVOKE EXECUTE ON FUNCTION public.cb_search_chunks(text, integer)");
});

Deno.test("live smoke E2E validates controls and cleans all synthetic rows", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261014235500_aria_encrypt_step5_live_smoke_e2e.sql");
  assertStringIncludes(sql, "unclassified canonical memory insert was accepted");
  assertStringIncludes(sql, "FROM aria_memory.search_lexical(marker,20)");
  assertStringIncludes(sql, "public.aria_memory_search_hybrid_text(marker,NULL,20,0.55,0.45,50)");
  assertStringIncludes(sql, "public.aria_memory_learning_context_for_goal(marker,50)");
  assertStringIncludes(sql, "unclassified learning insert was accepted");
  assertStringIncludes(sql, "unclassified shared document insert was accepted");
  assertStringIncludes(sql, "public.cb_search_chunks(marker,10)");
  assertStringIncludes(sql, "unclassified memory candidate insert was accepted");
  assertStringIncludes(sql, "[REDACTED: query content not retained]");
  assertStringIncludes(sql, "DELETE FROM public.cb_retrieval_events WHERE id=v_event_id;");
  assertStringIncludes(sql, "DELETE FROM public.cb_memory_candidates WHERE id=v_candidate_id;");
  assertStringIncludes(sql, "DELETE FROM public.cb_documents WHERE id=v_document_id;");
  assertStringIncludes(sql, "DELETE FROM aria_internal.autonomy_learnings WHERE lesson_id=v_learning_id;");
  assertStringIncludes(sql, "DELETE FROM aria_memory.memory_items WHERE memory_id=v_memory_id;");
  assertStringIncludes(sql, "synthetic fixture cleanup left rows behind");
  assertStringIncludes(sql, "COMMIT;");
});

Deno.test("mission learning trigger requires an explicitly general mission", async () => {
  const sql = await Deno.readTextFile("supabase/migrations/20261014235000_aria_encrypt_step5_gate_mission_learning_trigger.sql");
  assertStringIncludes(sql, "IF coalesce(new.metadata->>'privacy_class','') IS DISTINCT FROM 'general' THEN");
  assertStringIncludes(sql, "mission_id,goal_id,category,summary,evidence,confidence,reusable,privacy_class");
  assertStringIncludes(sql, "v_confidence,v_reusable,'general'");
  assertStringIncludes(sql, "privacy_class=excluded.privacy_class");
  assertStringIncludes(sql, "trg_capture_mission_learning");
});
