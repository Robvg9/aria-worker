# ARIA Encrypt — Step 5 route closure review

**Status: implementation/evidence prepared; LIVE closure is BLOCKED.** This document deliberately does not claim that existing routes are protected until the migration and Edge Function updates are applied and verified against the live project.

## Scope and current project evidence

Project checked: Supabase `icuqsstxfdbvjytkhlog`, 14 October 2026. The Edge Function inventory returned active versions across Memory, Retrieval, MCP/OAuth, gateway and runtime families. Relevant active versions seen during this audit included:

- `aria-context-retrieval-v1` v100, `verify_jwt=true`
- `aria-memory-bridge-v1` v100 and `aria-memory-bridge-9-4` v104, both `verify_jwt=true`; the inspected 9-4 bridge currently has `BRIDGE_ENABLED = false`
- `aria-memory-write-gate-v1` v100, `verify_jwt=true`
- `aria-memory-v2` v109, `verify_jwt=false`
- multiple MCP server/gateway/OAuth versions, including `aria-mcp-server-v2` v104, `aria-mcp-server-v3` v101 and `aria-mcp-inbound-grok-v1` v126

A missing Supabase JWT gate does **not** by itself prove an endpoint is publicly exposed. Several MCP/OAuth handlers perform their own token, JWT, or OAuth checks. The issue identified here is specific to the confirmed read/write paths below, not a blanket assertion that every `verify_jwt=false` function is vulnerable.

## Verified findings

1. **Retrieval returns plaintext from the general ChatBending index.** The live `aria-context-retrieval-v1` verifies a user JWT, then uses the service-role key to select `cb_chunks.content` from all `vigente` documents; the reviewed version has no privacy-class predicate or vault-unlock boundary. It returns result content and the document object to the caller.
2. **Direct content RPCs have client EXECUTE grants.** The live PostgreSQL privilege query reported `anon_exec=true` and `authenticated_exec=true` for `public.cb_search_chunks(text,integer)`, which returns chunk title/content, and `aria_memory.learning_context_for_goal(text,integer)`, which returns memory title/content. `public.cb_record_retrieval` is also executable by those roles and stores the raw `query_text`.
3. **Legacy index/memory rows are not privacy-classified.** Sampled `cb_documents.metadata` values were empty or contained operational role labels rather than `privacy_class`. In the current `aria_memory.memory_items` count of 19,019 rows, none had `privacy_class`, `classification`, `sensitivity`, or `visibility` at the top level of metadata. Historical count results differed by two rows between audit calls; no row contents were changed in this review.
4. **Candidate writes can stage plaintext.** The live `aria-memory-write-gate-v1` writes a submitted message into `cb_memory_candidates.candidate_text`. It checks the caller JWT and the `aria_memory_write` app-metadata claim, but does not itself require a privacy classification. The deployed bridge `aria-memory-bridge-9-4` is currently disabled.
5. **Historical retrieval events may already contain raw queries.** The live `cb_retrieval_events` schema contains a text `query` field. This step does not bulk rewrite/delete existing events; that requires retention/backup review in Step 6.

## Changes prepared in source control (not live)

Branch: `aria/encrypt-step5-route-closure`, stacked on Step 4 branch `aria/encrypt-step4-vault-api`.

- `supabase/migrations/20261014162000_aria_encrypt_step5_route_lockdown.sql`
  - Revokes direct client privileges on the four shared `cb_*` index/event tables, including non-SELECT privileges.
  - Revokes client EXECUTE on `cb_search_chunks`, `cb_record_retrieval` and `aria_memory.learning_context_for_goal`.
  - Changes future retrieval audit writes to store a fixed redaction marker plus a bounded metadata allowlist, not the caller's query.
  - Adds explicit class gates for indexed documents, chunks, staged candidates and canonical memory rows.
  - Restricts hybrid, lexical and learning-context memory queries to rows marked `metadata.privacy_class = 'general'`.
  - Keeps existing rows in place; it does not silently label or delete old data.
- `supabase/functions/aria-context-retrieval-v1/index.ts`
  - Verifies a real Supabase user token, rejects unapproved origins, caps the streamed request body, rejects unknown request fields, applies an explicit general-only predicate, rechecks class in code, redacts audit inputs, and avoids returning the query or raw DB errors.
- `supabase/functions/_shared/private-route-contract.ts` and `supabase/functions/_tests/private-route-closure.test.ts`
  - Add bounded request/classification contracts and static boundary assertions.
- `.github/workflows/aria-encrypt-route-closure.yml`
  - Runs Deno contract tests and a type check when the PR is opened/updated.
- This report records the route-by-route audit and exact limitations.

## Important compatibility consequence — fail closed

Current content has no explicit `privacy_class = 'general'` for the reviewed rows. Therefore the proposed retrieval gate will return **no indexed chunks until each document/memory item has been reviewed and explicitly classified**. The proposed memory-write trigger also rejects a new candidate that omits the new class. This can disable shared retrieval/memory-capture behavior until the compatible clients and reviewed classifications are ready. It is intentional fail-closed behavior; it must be announced/validated before deployment rather than applied silently.

No personal data was migrated, deleted, reclassified, or edited during the audit.

## Why Step 5 is not yet PASS for LIVE

A direct attempt to apply the database privilege/redaction migration using the connected Supabase write tool was blocked by the tool's safety control. No alternate write path was used to bypass that control. Consequently:

- the SQL migration is **not applied** to the project;
- the retrieval Edge Function update is **not deployed**;
- the RPC grants on the live database are **not changed**;
- no anonymous/authenticated negative E2E has been run after a mitigation;
- no live retrieval regression test has confirmed that unclassified content is denied;
- no data/metadata has been bulk changed and no historical retrieval events have been cleaned.

The security weakness remains present in the live system until the authorized migration and new function version are applied and verified.

## Acceptance checklist

- [x] Audit active Retrieval, Memory-write/bridge, relevant MCP/gateway versions, direct content RPC grants, index metadata, and query-log shape in the live project.
- [x] Identify the exact plaintext-returning RPCs and raw query logging path with live privilege/code evidence.
- [x] Prepare database changes that revoke direct content RPC access, redact new retrieval audit records, and filter general retrieval by explicit classification.
- [x] Prepare bounded/JWT-protected retrieval handler and automated contract/type-check workflow.
- [ ] Run the branch CI and require PASS.
- [ ] Review and merge the Step 4 dependency and this stacked Step 5 PR in sequence.
- [ ] Apply the SQL migration through an authorized Supabase deployment path; then query back and verify grants, trigger/function definitions and schema.
- [ ] Deploy the retrieval function and identify the deployed version/hash.
- [ ] Run negative E2E using anon, an ordinary authenticated user, and unclassified/private synthetic data; verify all content routes deny it. Run positive E2E on a reviewed general fixture.
- [ ] Review/write-gate caller compatibility and classify existing rows deliberately without silently exposing them. Existing unclassified content must remain excluded.
- [ ] Inspect logs for new raw-query retention and schedule historical event review under Step 6.
- [ ] Persist deployment, tests, grants, synthetic request/response and hash evidence before marking the step PASS.

**Conclusion:** the audit has proved the important live gaps and source remediation is prepared on a dedicated branch. Step 5 remains **BLOCKED / NOT CLOSED for production**, specifically because the live database controls and deployed retrieval route have not yet been changed or E2E-verified. Steps 6–8 remain open.