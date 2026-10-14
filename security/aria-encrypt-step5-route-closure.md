# ARIA Encrypt — Step 5 route closure review

**Status: route-level fail-closed mitigations are LIVE across identified retrieval, memory-write, and internal learning paths; full Step 5 remains BLOCKED.** Retrieval v101 excludes unclassified documents; Memory Write Gate v101 rejects candidate writes; `aria-memory-v2` v110 closes `remember`, `search`, `embed_missing`, and `maintenance`; and `aria-learning-v2` v92, `aria-learning-v3` v93, and `aria-learning-consolidator-v1` v93 return 503 after their existing internal authorization and before reading mission data. The database classification/grant migration remains unapplied because the official Supabase migration operation was blocked; no alternate SQL write channel was used.

## Scope and current project evidence

Project checked: Supabase `icuqsstxfdbvjytkhlog`, 14 October 2026. The Edge Function inventory returned active versions across Memory, Retrieval, MCP/OAuth, gateway and runtime families. Relevant active versions seen during this audit included:

- `aria-context-retrieval-v1` v101, `verify_jwt=true` (deployed fail-closed privacy class predicate)
- `aria-memory-bridge-v1` v100 and `aria-memory-bridge-9-4` v104, both `verify_jwt=true`; the inspected 9-4 bridge currently has `BRIDGE_ENABLED = false`
- `aria-memory-write-gate-v1` v101, `verify_jwt=true` (deployed temporary write stop until classification control is live)
- `aria-memory-v2` v110, `verify_jwt=false` (existing custom shared-secret/cron authorization retained; the action guard is deployed LIVE, hash `788fb3fb1c59af6f364b73b437e8e6a102abfd92de2573e0fe53622924edcf84`)
- `aria-learning-v2` v92, `verify_jwt=false`, hash `5256756b0389468af3e839434a4c3c68c64f1b168b41535df9ab9dbf5ad04899` (internal auth retained; gated before mission reads)
- `aria-learning-v3` v93, `verify_jwt=false`, hash `a8f613604959db8d4724c2e1a9bc321f3179b1d4b9b6c673cf7c04ffb3755168` (internal auth retained; gated before mission reads)
- `aria-learning-consolidator-v1` v93, `verify_jwt=false`, hash `af00bb9bd7434969b846077cb3c5e1fecceaa214cf319b5a22ac38957c5a8fcc` (internal auth retained; gated before scanning mission state)
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
  - Current workflow [run 38626099409](https://github.com/Robvg9/aria-worker/actions/runs/38626099409), commit `15a38c293bda3ab1ad7d571fc33509ce3dd637a4`, passed **8/8 contract tests** and Deno type-checks for Retrieval, Memory Write Gate, `aria-memory-v2`, `aria-learning-v2`, `aria-learning-v3`, and `aria-learning-consolidator-v1`. The tests also assert proposed SQL class filters for internal mastery/preflight and the scoped-search wrapper.
- This report records the route-by-route audit and exact limitations.

## Important compatibility consequence — fail closed

Current sampled content has no explicit `privacy_class = 'general'`, so Retrieval v101 excludes those rows and fails closed until classification. Memory Write Gate v101 returns 503 for candidate writes. `aria-memory-v2` v110 blocks `remember`, `search`, `embed_missing`, and `maintenance`. The three internal learning routes now also return 503 after internal authentication and before parsing body-provided mission identifiers or querying `mission_state`. The current workflow's contracts and type checks passed in run `38626099409`. These are route/source checks plus no-auth probes, not valid internal-token E2E and not evidence that the SQL migration is live.

No personal data was migrated, deleted, reclassified, or edited during the audit.

## Why Step 5 is not yet PASS for LIVE

A direct attempt to apply the database privilege/redaction migration using the connected Supabase write tool was blocked by the tool's safety control. No alternate write path was used to bypass that control. Consequently:

- the SQL migration is **not applied** to the project; the official migration call was blocked by the tool's safety control, so no grants/triggers/search-function changes are live;
- Retrieval v101 is deployed and active with `verify_jwt=true`; Memory Write Gate v101 is deployed and active with `verify_jwt=true` and fails closed before any candidate insert;
- live HTTP probes from RobVG produced `401 UNAUTHORIZED_NO_AUTH_HEADER` for Retrieval without auth and `401 UNAUTHORIZED_INVALID_JWT_FORMAT` for both Retrieval and Write Gate with a synthetic invalid JWT. These are negative authentication probes, not authenticated content E2E;
- RPC EXECUTE grants remain catalogued, but direct calls simulated as `anon` fail due missing table privileges, and the `aria_memory` schema is not usable by `anon`/`authenticated`. The migration is still required for least-privilege cleanup and to enforce future classification/search gates;
- `aria-memory-v2` fail-closed guard is now validated by contract tests and Deno type-check in [run 38624073227](https://github.com/Robvg9/aria-worker/actions/runs/38624073227), and deployed LIVE as v110 with hash `788fb3fb1c59af6f364b73b437e8e6a102abfd92de2573e0fe53622924edcf84`. The remaining HTTP probe without internal auth returns 401; a valid internal-secret/cron-token E2E has not been run.
- no valid signed-in JWT E2E, no positive general-content E2E, no schema/grant verification after migration, no bulk data changes, and no historical event cleanup have occurred.

Risk reduction is now live across Retrieval, Memory Write Gate, `aria-memory-v2`, and three internal learning/consolidation endpoints. Step 5 remains incomplete because the database migration is unapplied, so SQL-trigger/query-filter changes (including internal preflight/mastery and the scoped hybrid-search wrapper) are not live; no post-migration catalog readback or valid internal-auth E2E with classified/unclassified fixtures has been run.

## Acceptance checklist

- [x] Audit active Retrieval, Memory-write/bridge, relevant MCP/gateway versions, direct content RPC grants, index metadata, and query-log shape in the live project.
- [x] Identify the retrieval plaintext path and raw query logging behavior; confirm that direct client RPC calls fail under the current role grants rather than overstate them as effective anonymous access.
- [x] Prepare database changes that revoke direct content RPC access, redact new retrieval audit records, and filter general retrieval by explicit classification.
- [x] Prepare bounded/JWT-protected retrieval handler and automated contract/type-check workflow.
- [x] Earlier CI run `38605443820` passed the Retrieval and Memory Write Gate contracts/type checks.
- [x] Updated CI verified PASS on commit `15a38c293bda3ab1ad7d571fc33509ce3dd637a4` — [run 38626099409](https://github.com/Robvg9/aria-worker/actions/runs/38626099409): 8/8 contract tests and Deno type-checks for Retrieval, Memory Write Gate, `aria-memory-v2`, learning-v2, learning-v3, and the consolidator; includes SQL classification contracts for internal preflight/mastery and the scoped-search wrapper.
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

**Latest live verification (14-10-2026):** `aria-memory-v2` v110, `aria-learning-v2` v92, `aria-learning-v3` v93, and `aria-learning-consolidator-v1` v93 are ACTIVE with existing internal auth retained (`verify_jwt=false`). RobVG POST probes without internal auth returned 401 for all four. `aria-memory-v2` GET returned 200 with only `access` listed as active and its other memory/maintenance actions temporarily disabled. No probe used a valid internal secret/cron token, so the guarded 503 branches are source/CI-verified, not valid-token E2E.

**Conclusion:** Step 5 remains **PARTIALLY MITIGATED but NOT CLOSED**. Retrieval v101, Memory Write Gate v101, `aria-memory-v2` v110, and the three internal learning/consolidation routes are deployed fail-closed. CI passes 8/8 contract tests plus Deno type-checks for the six source areas. The migration source also filters `capture_failure_mastery`, `enforce_learning_preflight`, `validate_learning_preflight`, `verify_learning_application`, and replaces `aria_memory_search_hybrid_text_scoped` with a class-filtered wrapper. However, the migration is **not applied**, so none of these database-level filters/triggers/grant changes are production controls yet. The current database preflight/mastery functions remain a residual LIVE gap until the authorized migration is applied and verified. A valid internal-auth E2E with general/private/unclassified fixtures and post-migration catalog readback is required. Do not merge the stacked draft PR until then; Steps 6–8 and the global mission remain open.

## Superseding follow-up — live internal memory closure and database-read audit (14-10-2026)

- The route guard on branch commit `a3a2447c98772cae01d9f440e2ce5aef628adfa2` was expanded to close `maintenance` along with `remember`, `search`, and `embed_missing` while classification is pending. GET reports the temporarily disabled capabilities accurately.
- Contract tests now check that the guard appears before all four action handlers and that the Deno type-check includes `aria-memory-v2`. The strict Deno config includes `nodeModulesDir: auto` and a declaration for the Edge Runtime-provided `Supabase.ai.Session` API; the check is not disabled or skipped.
- The proposed migration now also replaces `aria_memory.list_unembedded` with a `privacy_class='general'` filter; filters `learning_preflight`, skill compilation, failure-learning promotion, reflection, and duplicate consolidation; and ensures automated mission-outcome capture returns early unless the source mission metadata is explicitly `privacy_class='general'`. This prevents the new memory trigger from breaking mission updates that are not classified, while preserving fail-closed behavior.
- A catalog review confirmed `aria_memory.learning_context_for_goal` currently has default PUBLIC execute (catalog ACL is NULL). The migration explicitly revokes PUBLIC/anon/authenticated and re-grants `EXECUTE` to `service_role` so least-privilege hardening does not accidentally remove the trusted internal grant.
- Actual deployment and HTTP probe evidence: LIVE v110 hash `788fb3fb1c59af6f364b73b437e8e6a102abfd92de2573e0fe53622924edcf84`; GET returns `200` and advertises only `access` as active; POST without internal auth returns `401`. Authenticated action-level E2E remains pending because the test did not possess the internal shared secret or cron token.
- The database migration call remains blocked by the official write-tool safety control; no alternate SQL write channel was used. Thus the SQL edits described above are reviewed, source-controlled, and contract-tested in the branch, but are **not production database controls yet**.


## Superseding follow-up — expanded internal route and SQL consumer audit (14-10-2026)

- Additional live internal learning routes are now closed while classification is pending: `aria-learning-v2` v92, `aria-learning-v3` v93, and `aria-learning-consolidator-v1` v93. Each keeps its existing secret/cron authorization and responds 503 before parsing body-provided mission identifiers, scanning `mission_state`, or writing learning records. POST requests without internal authentication returned HTTP 401 on all three routes.
- MCP route scan: `aria-mcp-server-v3`, `aria-mcp-server-9-5`, and `aria-mcp-server-grok-v4` delegate context retrieval to `aria-context-retrieval-v1` and memory capture to the disabled `aria-memory-bridge-9-4`. Legacy `aria-mcp-server` and `aria-mcp-server-v2` refer to the absent `chatbending-auto-retrieval` handler rather than a direct `aria_memory.memory_items` query. `aria-mcp-server-static` responds with fixed text; `aria-mcp-inbound-grok-v1` uses a static read-only context snapshot and has no direct `memory_items` query.
- The migration source now additionally replaces `aria_internal.capture_failure_mastery` with a general-class source gate and a general-only lookup/update; filters `aria_internal.enforce_learning_preflight`, `validate_learning_preflight`, and `verify_learning_application` to explicitly general-class memories; and replaces `public.aria_memory_search_hybrid_text_scoped` with a wrapper delegating to the class-filtered `aria_memory.search_hybrid_user_scoped`.
- Strengthened source contracts passed in [run 38626099409](https://github.com/Robvg9/aria-worker/actions/runs/38626099409): 8 tests, 0 failures, and type-checks for Retrieval, Memory Write Gate, `aria-memory-v2`, learning-v2, learning-v3, and the consolidator.
- **Residual remains unchanged:** these SQL changes are only in the open PR's migration file. The official Supabase migration call was blocked; no alternate SQL write channel was used. Production database triggers/filters/grants therefore remain unchanged, including the existing preflight/mastery SQL consumers. Step 5 remains open.
