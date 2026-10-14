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

Deno.test("aria-memory-v2 fails closed before search, remember, and embedding actions", async () => {
  const source = await Deno.readTextFile("supabase/functions/aria-memory-v2/index.ts");
  const guardIndex = source.indexOf("if(['remember','search','embed_missing'].includes(action))");
  const rememberHandlerIndex = source.indexOf("if(action==='remember')");
  const searchHandlerIndex = source.indexOf("if(action==='search')");
  const embedHandlerIndex = source.indexOf("if(action==='embed_missing')");
  assertEquals(guardIndex >= 0, true);
  assertEquals(rememberHandlerIndex >= 0, true);
  assertEquals(searchHandlerIndex >= 0, true);
  assertEquals(embedHandlerIndex >= 0, true);
  assertEquals(guardIndex < rememberHandlerIndex, true);
  assertEquals(guardIndex < searchHandlerIndex, true);
  assertEquals(guardIndex < embedHandlerIndex, true);
  assertStringIncludes(source, "ARIA_MEMORY_PRIVACY_GATE_CLOSED");
  assertStringIncludes(source, "privacy_classification_pending");
});
