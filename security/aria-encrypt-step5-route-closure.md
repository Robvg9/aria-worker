# ARIA Encrypt — Step 5 route closure review

**Status: partial LIVE mitigations deployed; full Step 5 is BLOCKED.** Retrieval v101 is now fail-closed for unclassified index documents, and Memory Write Gate v101 temporarily refuses all memory-candidate writes. The database classification/grant migration was blocked by the official Supabase write tool; no alternate write channel was used.

## Scope and current project evidence

Project checked: Supabase `icuqsstxfdbvjytkhlog`, 14 October 2026. The Edge Function inventory returned active versions across Memory, Retrieval, MCP/OAuth, gateway and runtime families. Relevant active versions seen during this audit included:

- `aria-context-retrieval-v1` v101, `verify_jwt=true` (deployed fail-closed privacy class predicate)
- `aria-memory-bridge-v1` v100 and `aria-memory-bridge-9-4` v104, both `verify_jwt=true`; the inspected 9-4 bridge currently has `BRIDGE_ENABLED = false`
- `aria-memory-write-gate-v1` v101, `verify_jwt=true` (deployed temporary write stop until classification control is live)
- `aria-memory-v2` v109, `verify_jwt=false`
- multiple MCP server/gateway/OAuth versions, including `aria-mcp-server-v2` v104, `aria-mcp-server-v3` v101 and `aria-mcp-inbound-grok-v1` v126

A missing Supabase JWT gate does **not** by itself prove an endpoint is publicly exposed. Several MCP/OAuth handlers perform their own token, JWT, or OAuth checks. The issue identified here is specific to the confirmed read/write paths below, not a blanket assertion that every `verify_jwt=false` function is vulnerable.

## Verified findings

1. **Confirmed Retrieval boundary gap, now partially mitigated.** Live v100 verified a user JWT but used the service-role credential to return content from all `vigente` documents with no privacy-class predicate or vault-unlock boundary. That version was replaced by deployed v101, which requires `metadata.privacy_class = 'general'` in the query and checks it again in code. The current sampled documents have no such class, so they are excluded (fail-closed). The live endpoint was probed without auth and with a fake JWT; both requests returned 401. A positive authenticated content E2E has not been run.
2. **Excess direct RPC EXECUTE grants exist, but effective anonymous content access was NOT demonstrated.** The privilege catalog reports EXECUTE for `anon`/`authenticated` on `public.cb_search_chunks` and `public.cb_record_retrieval`. Follow-up checks are more specific: `anon` and `authenticated` lack SELECT on `cb_chunks`/`cb_documents`; simulating `SET ROLE anon` and calling `cb_search_chunks` failed with `permission denied for table cb_chunks`. Calling `cb_record_retrieval` as `anon` failed with `permission denied for table cb_retrieval_events`. `anon` and `authenticated` also lack USAGE on schema `aria_memory`; the public learning-context wrapper is granted to `service_role`, not these client roles. Therefore these grants should be revoked as least-privilege hardening, but they are not being represented as a proven anonymous data-return path.
3. **Legacy index/memory rows are not privacy-classified.** Sampled `cb_documents.metadata` values were empty or contained operational role labels rather than `privacy_class`. In the current `aria_memory.memory_items` count of 19,019 rows, none had `privacy_class`, `classification`, `sensitivity`, or `visibility` at the top level of metadata. Historical count results differed by two rows between audit calls; no row contents were changed in this review.
4. **Candidate writes could previously stage plaintext; the route is now temporarily closed.** Live v100 wrote `message` to `cb_memory_candidates.candidate_text` after checking JWT and the `aria_memory_write` claim, without requiring privacy classification. Deployed v101 keeps authentication and the claim check but returns `503 ARIA_MEMORY_PRIVACY_GATE_CLOSED` for all write requests before any database insert. This is an intentional temporary outage until classification/persistence controls are live. The deployed `aria-memory-bridge-9-4` code is also disabled.
5. **Historical retrieval events may already contain raw queries.** The live `cb_retrieval_events` schema contains a text `query` field. This step does not bulk rewrite/delete existing events; that requires retention/backup review in Step 6.

## Source remediations and partial LIVE deployment

Branch: `aria/encrypt-step5-route-closure`, stacked on Step 4 branch `aria/encrypt-step4-vault-api`.

- `supabase/migrations/20261014162000_aria_encrypt_step5_route_lockdown.sql`
  - Revokes direct client privileges on the four shared `cb_*` index/event tables, including non-SELECT privileges.
  - Revokes client EXECUTE on `cb_search_chunks`, `cb_record_retrieval` and `aria_memory.learning_context_for_goal`.
  - Changes future retrieval audit writes to store a fixed redaction marker plus a bounded metadata allowlist, not the caller's query.
  - Adds explicit class gates for indexed documents, chunks, staged candidates and canonical memory rows.
  - Restricts hybrid, lexical and learning-context memory queries to rows marked `metadata.privacy_class = 'general'`.
  - Keeps existing rows in place; it does not silently label or delete old data.
- `supabase/functions/aria-context-retrieval-v1/index.ts`
  - **Deployed LIVE as version 101** with `verify_jwt=true`; confirmed active through the Supabase function inventory after deployment. Deployed function hash: `8bd0f71e618e13671c7b32d202e99a8ac00d2a53ad7f1286856930b8f9c0b192`. Source blob `d7999fac5c75590077357d8323cffc1a4fdbcc8d`.
  - Verifies a real Supabase user token, rejects unapproved origins, caps the streamed request body, rejects unknown request fields, applies an explicit general-only predicate, rechecks class in code, redacts audit inputs, and avoids returning the query or raw DB errors.
- `supabase/functions/aria-memory-write-gate-v1/index.ts`
  - **Deployed LIVE as version 101** with `verify_jwt=true`; hash `1d9322321b2c3a0f4329ca05e1db3627f2574234b2fc2b798237bb404de03498`. Returns a generic 503 `ARIA_MEMORY_PRIVACY_GATE_CLOSED` for a correctly authenticated, write-claimed request and performs no insert/logging of request content.
- `supabase/functions/_shared/private-route-contract.ts` and `supabase/functions/_tests/private-route-closure.test.ts`
  - Add bounded request/classification contracts and source-level guards for retrieval/write closure.
- `.github/workflows/aria-encrypt-route-closure.yml`
  - Runs Deno contract tests plus type checks for the deployed Retrieval and Write Gate source. CI run `38604939519` passed on commit `a25975b243b03328e05e8c35087e057d0eeb9d45` (four initial contracts plus the write-gate contract and both type checks).
- This report records the route-by-route audit and exact limitations.

## Important compatibility consequence — fail closed

Current content has no explicit `privacy_class = 'general'` for the reviewed rows. The live Retrieval v101 therefore returns no indexed chunks until documents are reviewed and explicitly classified. The live Write Gate v101 returns 503 for all candidate writes, so memory capture through that endpoint is temporarily disabled. The proposed SQL trigger will also reject unclassified candidates and memory writes once applied. Separately, a branch-only patch was attempted for internal `aria-memory-v2` to reject `remember`, `search`, and `embed_missing`, but the follow-on CI/test update was blocked; that patch is **not validated and not deployed**. Do not merge it until reviewed/tested.

No personal data was migrated, deleted, reclassified, or edited during the audit.

## Why Step 5 is not yet PASS for LIVE

A direct attempt to apply the database privilege/redaction migration using the connected Supabase write tool was blocked by the tool's safety control. No alternate write path was used to bypass that control. Consequently:

- the SQL migration is **not applied** to the project; the official migration call was blocked by the tool's safety control, so no grants/triggers/search-function changes are live;
- Retrieval v101 is deployed and active with `verify_jwt=true`; Memory Write Gate v101 is deployed and active with `verify_jwt=true` and fails closed before any candidate insert;
- live HTTP probes from RobVG produced `401 UNAUTHORIZED_NO_AUTH_HEADER` for Retrieval without auth and `401 UNAUTHORIZED_INVALID_JWT_FORMAT` for both Retrieval and Write Gate with a synthetic invalid JWT. These are negative authentication probes, not authenticated content E2E;
- RPC EXECUTE grants remain catalogued, but direct calls simulated as `anon` fail due missing table privileges, and the `aria_memory` schema is not usable by `anon`/`authenticated`. The migration is still required for least-privilege cleanup and to enforce future classification/search gates;
- a branch-only `aria-memory-v2` fail-closed patch is present at commit `3e3c9a89b1bcd3c30ec9f35e3c7e61da6e16fbf4`, but its follow-on tests/CI update was blocked. It is not deployed and the last passing CI does not cover that patch;
- no valid signed-in JWT E2E, no positive general-content E2E, no schema/grant verification after migration, no bulk data changes, and no historical event cleanup have occurred.

Risk reduction is now live at the Retrieval and Memory Write Gate layers, but Step 5 remains incomplete: the database migration was blocked, internal `aria-memory-v2` remains deployed v109 with the previous search/write behavior, and authenticated E2E has not validated positive/negative content behavior.

## Acceptance checklist

- [x] Audit active Retrieval, Memory-write/bridge, relevant MCP/gateway versions, direct content RPC grants, index metadata, and query-log shape in the live project.
- [x] Identify the retrieval plaintext path and raw query logging behavior; confirm that direct client RPC calls fail under the current role grants rather than overstate them as effective anonymous access.
- [x] Prepare database changes that revoke direct content RPC access, redact new retrieval audit records, and filter general retrieval by explicit classification.
- [x] Prepare bounded/JWT-protected retrieval handler and automated contract/type-check workflow.
- [x] CI verified PASS on commit `a25975b243b03328e05e8c35087e057d0eeb9d45` — [run 38604939519](https://github.com/Robvg9/aria-worker/actions/runs/38604939519): privacy contract tests and type checks for Retrieval and Memory Write Gate.
- [ ] Review and merge the Step 4 dependency and this stacked Step 5 PR in sequence.
- [ ] Apply the SQL migration through the official authorized Supabase migration path; the call is currently blocked by tool safety controls. Then query back grants, triggers, function definitions and schema.
- [x] Deploy Retrieval v101 with `verify_jwt=true`; hash `8bd0f71e618e13671c7b32d202e99a8ac00d2a53ad7f1286856930b8f9c0b192`.
- [x] Deploy Memory Write Gate v101 fail-closed with `verify_jwt=true`; hash `1d9322321b2c3a0f4329ca05e1db3627f2574234b2fc2b798237bb404de03498`.
- [x] Run anonymous/invalid-token negative HTTP probes on both functions from RobVG; both returned 401.
- [ ] Run authenticated live E2E and prove the general-only predicate rejects unclassified/private fixtures.
- [ ] Run negative E2E using anon, an ordinary authenticated user, and unclassified/private synthetic data; verify all content routes deny it. Run positive E2E on a reviewed general fixture.
- [ ] Review/write-gate caller compatibility and classify existing rows deliberately without silently exposing them. Existing unclassified content must remain excluded.
- [ ] Inspect logs for new raw-query retention and schedule historical event review under Step 6.
- [ ] Persist deployment, tests, grants, synthetic request/response and hash evidence before marking the step PASS.

**Conclusion:** Step 5 is **partially mitigated but NOT CLOSED**. Retrieval and Memory Write Gate are deployed fail-closed and their auth boundary has negative-probe evidence. The SQL migration remains blocked, unclassified memory is still present, `aria-memory-v2` v109 remains an internal alternative route until the DB filter/temporary block is validated and deployed, and no authenticated content E2E has been run. The branch contains an unvalidated `aria-memory-v2` patch that must not be merged as-is. Steps 6–8 and the mission remain open.