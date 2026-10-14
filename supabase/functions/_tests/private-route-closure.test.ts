import { assert, assertEquals, assertStringIncludes, assertStringExcludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
  assertStringIncludes(sql, "[REDACTED: query content not retained]");
  assertStringIncludes(sql, "aria_encrypt_general_memory_guard");
  assertStringIncludes(sql, "aria_encrypt_general_document_guard");
  assertStringIncludes(sql, "aria_encrypt_general_chunk_guard");
  assertStringIncludes(sql, "aria_encrypt_general_candidate_guard");
  assertStringIncludes(sql, "m.metadata->>'privacy_class'='general'");
});

Deno.test("retrieval source uses an explicit general-only query and does not echo or return metadata blobs", async () => {
  const source = await Deno.readTextFile("supabase/functions/aria-context-retrieval-v1/index.ts");
  assertStringIncludes(source, '.filter("cb_documents.metadata->>privacy_class", "eq", "general")');
  assertStringIncludes(source, "canEnterGeneralIndex(row.cb_documents?.metadata)");
  assertStringIncludes(source, 'query_text: "[REDACTED]"');
  assertStringExcludes(source, "return reply(200, { query,");
  assertStringExcludes(source, "metadata: item.row.metadata");
  assertStringExcludes(source, "detail: error.message");
});
