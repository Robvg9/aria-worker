# ARIA Encrypt — Step 5 route closure review

**Current status (14 Oct 2026): database controls and synthetic database E2E are LIVE and verified; the Step 5 acceptance remains BLOCKED only on an authenticated Edge HTTP E2E and deliberate classification of the existing corpus.** Applied DB migrations `20261014225549 aria_encrypt_step5_route_lockdown` and `20261014231437 aria_encrypt_step5_learning_table_and_cb_search`; all classification triggers are enabled, direct client grants are revoked, and route handlers remain fail-closed. CI run [38653538194](https://github.com/Robvg9/aria-worker/actions/runs/38653538194) passed 9/9 contracts and 14 Deno checks. No real content was modified or classified.

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

Current rows without explicit `privacy_class='general'` remain excluded. Live code filters exist in Retrieval v101, `aria-memory-v2` v110, learning v2/v3/consolidator, direct-memory PWA/planner readers, legacy supervisors and Device Gateway v269. The learning table itself now has a `privacy_class` column and trigger requiring `general` for new/updated content. These rows are intentionally not reclassified automatically; the existing corpus remains unclassified and general-memory retrieval therefore returns no legacy content.

No personal data was migrated, deleted, reclassified, or edited during the audit.

## Remaining gates before Step 5 can be marked PASS

Both database migrations were applied successfully through the official Supabase migration path. Registry readback confirms versions `20261014225549` (`aria_encrypt_step5_route_lockdown`) and `20261014231437` (`aria_encrypt_step5_learning_table_and_cb_search`). The first readback confirmed four enabled guards on documents, chunks, candidates and canonical memory; the follow-up confirmed the fifth guard on `aria_internal.autonomy_learnings`, `privacy_class` defaults to `unclassified`, and `cb_search_chunks` is general-only. No alternate SQL write channel was used.

- database controls are now LIVE: `anon` and `authenticated` have no `SELECT` on `cb_documents`, `cb_chunks`, `cb_memory_candidates` or `cb_retrieval_events`, and no `EXECUTE` on `cb_search_chunks`, `cb_record_retrieval` or `aria_memory.learning_context_for_goal`; `service_role` retains the required grants;
- Retrieval v101 is deployed and active with `verify_jwt=true`; Memory Write Gate v101 is deployed and active with `verify_jwt=true` and fails closed before any candidate insert;
- live HTTP probes from RobVG returned HTTP 401 without Authorization on 17 endpoints: Retrieval, Memory Write Gate, memory-v2, learning-v2/v3/consolidator, Device Gateway, PWA API v3, planners v7–v11 and autonomy supervisors v6–v9. Earlier invalid-JWT probes against Retrieval and Write Gate also returned 401. These prove the unauthenticated boundary, not a valid-token action flow;
- Catalog readback confirms the client grants are revoked; the general-only search wrappers delegate to SQL functions whose definitions contain `privacy_class='general'` predicates. `cb_search_chunks` explicitly filters `d.metadata->>'privacy_class'='general'`, and `cb_record_retrieval` persists `[REDACTED: query content not retained]`. The role probe showed client access false and service-role access true where required;
- LIVE Edge inventory confirms Retrieval v101, Memory Write Gate v101, memory-v2 v110, learning-v2 v92, learning-v3 v93, learning-consolidator v93, Device Gateway v269, PWA API v3 v270, planners v7–v11 and supervisors v6–v9 with general-class guards/read filters. Key hashes: Retrieval `8bd0f71e618e13671c7b32d202e99a8ac00d2a53ad7f1286856930b8f9c0b192`; Write Gate `1d9322321b2c3a0f4329ca05e1db3627f2574234b2fc2b798237bb404de03498`; memory-v2 `788fb3fb1c59af6f364b73b437e8e6a102abfd92de2573e0fe53622924edcf84`; Device Gateway `40c44f5772586407e7cb1f96a5f5f23fa3a555b0146823bd668f0f2fb0902b94`.
- A synthetic SQL E2E passed against LIVE PostgreSQL: a temporary `general` fixture was found by lexical search, hybrid search, learning-context and public wrappers; a temporary general document/chunk was found by `cb_search_chunks`; retrieval audit stored only the redaction marker; `private` and `unclassified` writes were rejected in `memory_items`, `cb_documents`, `cb_memory_candidates` and `autonomy_learnings`. The fixture/event rows were deleted within the same DO block and post-test row counts returned to baseline. Still absent: positive/negative HTTP E2E with a valid user JWT or valid internal secret/cron credential, and deliberate classification of existing data. No valid credentials were extracted or bypassed.

Route/data-boundary mitigations are live and database-backed. The remaining stop is specific: current inventory is 19,019 canonical memory rows (0 general), 8 documents (0 general), 23 chunks, 30 candidates (all unclassified), and 2,459 internal learning records (all unclassified). They remain untouched and fail-closed. Do not automatically mark them general: Step 5 cannot be signed off until valid-auth Edge E2E is run and classification is reviewed by an authorized owner; historical query-log retention remains Step 6.

## Acceptance checklist

- [x] Audit active Retrieval, Memory-write/bridge, relevant MCP/gateway versions, direct content RPC grants, index metadata, and query-log shape in the live project.
- [x] Identify the retrieval plaintext path and raw query logging behavior; confirm that direct client RPC calls fail under the current role grants rather than overstate them as effective anonymous access.
- [x] Prepare database changes that revoke direct content RPC access, redact new retrieval audit records, and filter general retrieval by explicit classification.
- [x] Prepare bounded/JWT-protected retrieval handler and automated contract/type-check workflow.
- [x] Earlier CI run `38605443820` passed the Retrieval and Memory Write Gate contracts/type checks.
- [x] Current CI run [38653538194](https://github.com/Robvg9/aria-worker/actions/runs/38653538194) on PR head `00105c05eef723d1b10cb33abbc788f9983b1ba4`: 9/9 privacy contracts passed and 14 configured Deno type-checks passed for Retrieval, Write Gate, memory/learning routes, planners v7–v10 and supervisors v6–v9. Legacy PWA API v3, planner v11 and Device Gateway have static contract coverage; whole-file `deno check` is excluded where unrelated pre-existing typing errors were confirmed.
- [ ] Review and merge the Step 4 dependency and this stacked Step 5 PR in sequence.
- [x] Apply both migrations by the official Supabase migration tool and verify catalog readback: `20261014225549 aria_encrypt_step5_route_lockdown`; `20261014231437 aria_encrypt_step5_learning_table_and_cb_search`.
- [x] Deploy Retrieval v101 with `verify_jwt=true`; hash `8bd0f71e618e13671c7b32d202e99a8ac00d2a53ad7f1286856930b8f9c0b192`.
- [x] Deploy Memory Write Gate v101 fail-closed with `verify_jwt=true`; hash `1d9322321b2c3a0f4329ca05e1db3627f2574234b2fc2b798237bb404de03498`.
- [x] Run anonymous/invalid-token negative HTTP probes on both functions from RobVG; both returned 401.
- [x] LIVE database E2E with synthetic fixtures: positive general-only reads + query redaction; private/unclassified write attempts rejected in all four protected content stores; fixture data removed and counts reconciled.
- [ ] HTTP E2E with a valid signed-in user JWT and a valid internal secret/cron token: positive general fixture and negative private/unclassified fixture. No such credentials were provided for this turn.
- [x] Unauthenticated HTTP probes: 17 route endpoints returned 401; database-role probes confirm `anon`/`authenticated` cannot read shared content tables or execute restricted RPCs.
- [ ] Valid-token HTTP content E2E and end-to-end review of reader/writer behavior before reopening paused memory actions.
- [ ] Review/write-gate caller compatibility and classify existing rows deliberately without silently exposing them. Existing unclassified content must remain excluded.
- [ ] Inspect logs for new raw-query retention and schedule historical event review under Step 6.
- [ ] Persist deployment, tests, grants, synthetic request/response and hash evidence before marking the step PASS.

**Latest live verification (14-10-2026):** Retrieval v101 ACTIVE (`verify_jwt=true`); Write Gate v101 ACTIVE (`verify_jwt=true`); memory-v2 v110, learning-v2 v92, learning-v3 v93 and consolidator v93 (`verify_jwt=false` with their existing internal authorization); Device Gateway v269 ACTIVE; PWA API v3 v270; planners v7–v11 and supervisors v6–v9. All 17 no-auth HTTP probes returned 401. DB migration catalog, triggers, grants, class predicates and synthetic E2E were read back after application. Row counts remain at baseline and no fixtures remain.

**Conclusion:** Step 5 is **database-remediated and technically verified, but NOT YET SIGNED OFF 100%**. Both migrations are LIVE, post-migration readback is complete, CI passed 9/9 contracts and 14 configured Deno checks, 17 unauthenticated route probes returned 401, and the synthetic database E2E passed. The real data remains unchanged and unclassified (19,019 memory rows, 8 documents, 30 candidates and 2,459 internal learning rows without `general` classification), so general retrieval of existing data is intentionally empty and memory routes remain fail-closed. A valid-token HTTP E2E with a synthetic general fixture plus private/unclassified negatives remains a human gate; stacked PR #1214 remains draft/open on Step 4 branch #1213. Steps 6–8 and the global encryption mission remain open.

## Superseding follow-up — live internal memory closure and database-read audit (14-10-2026)

- The route guard on branch commit `a3a2447c98772cae01d9f440e2ce5aef628adfa2` was expanded to close `maintenance` along with `remember`, `search`, and `embed_missing` while classification is pending. GET reports the temporarily disabled capabilities accurately.
- Contract tests now check that the guard appears before all four action handlers and that the Deno type-check includes `aria-memory-v2`. The strict Deno config includes `nodeModulesDir: auto` and a declaration for the Edge Runtime-provided `Supabase.ai.Session` API; the check is not disabled or skipped.
- The proposed migration now also replaces `aria_memory.list_unembedded` with a `privacy_class='general'` filter; filters `learning_preflight`, skill compilation, failure-learning promotion, reflection, and duplicate consolidation; and ensures automated mission-outcome capture returns early unless the source mission metadata is explicitly `privacy_class='general'`. This prevents the new memory trigger from breaking mission updates that are not classified, while preserving fail-closed behavior.
- A catalog review confirmed `aria_memory.learning_context_for_goal` currently has default PUBLIC execute (catalog ACL is NULL). The migration explicitly revokes PUBLIC/anon/authenticated and re-grants `EXECUTE` to `service_role` so least-privilege hardening does not accidentally remove the trusted internal grant.
- Actual deployment and HTTP probe evidence: LIVE v110 hash `788fb3fb1c59af6f364b73b437e8e6a102abfd92de2573e0fe53622924edcf84`; GET returns `200` and advertises only `access` as active; POST without internal auth returns `401`. Authenticated action-level E2E remains pending because the test did not possess the internal shared secret or cron token.
- Both database migrations are now applied and verified LIVE; see catalog versions `20261014225549` and `20261014231437`. The prior blocked attempts and SQL-terminator fixes remain historical context only.


## Superseding follow-up — expanded internal route and SQL consumer audit (14-10-2026)

- Additional live internal learning routes are now closed while classification is pending: `aria-learning-v2` v92, `aria-learning-v3` v93, and `aria-learning-consolidator-v1` v93. Each keeps its existing secret/cron authorization and responds 503 before parsing body-provided mission identifiers, scanning `mission_state`, or writing learning records. POST requests without internal authentication returned HTTP 401 on all three routes.
- MCP route scan: `aria-mcp-server-v3`, `aria-mcp-server-9-5`, and `aria-mcp-server-grok-v4` delegate context retrieval to `aria-context-retrieval-v1` and memory capture to the disabled `aria-memory-bridge-9-4`. Legacy `aria-mcp-server` and `aria-mcp-server-v2` refer to the absent `chatbending-auto-retrieval` handler rather than a direct `aria_memory.memory_items` query. `aria-mcp-server-static` responds with fixed text; `aria-mcp-inbound-grok-v1` uses a static read-only context snapshot and has no direct `memory_items` query.
- The migration source now additionally replaces `aria_internal.capture_failure_mastery` with a general-class source gate and a general-only lookup/update; filters `aria_internal.enforce_learning_preflight`, `validate_learning_preflight`, and `verify_learning_application` to explicitly general-class memories; and replaces `public.aria_memory_search_hybrid_text_scoped` with a wrapper delegating to the class-filtered `aria_memory.search_hybrid_user_scoped`.
- Strengthened source contracts passed in [run 38626099409](https://github.com/Robvg9/aria-worker/actions/runs/38626099409): 8 tests, 0 failures, and type-checks for Retrieval, Memory Write Gate, `aria-memory-v2`, learning-v2, learning-v3, and the consolidator.
- **Current residual:** SQL controls are applied LIVE, but the current general-class corpus is empty. Existing unclassified records are preserved; the remaining acceptance gate is valid-token HTTP E2E and deliberate classification, not migration application.


## Final superseding evidence — post-migration E2E and production reconciliation (14-10-2026)

### Database migrations and readback
- Applied through the official Supabase migration mechanism and confirmed in the migration registry:
  - `20261014225549 — aria_encrypt_step5_route_lockdown`
  - `20261014231437 — aria_encrypt_step5_learning_table_and_cb_search`
- Re-read trigger catalog: `aria_encrypt_general_document_guard`, `aria_encrypt_general_chunk_guard`, `aria_encrypt_general_candidate_guard`, `aria_encrypt_general_memory_guard`, and `aria_encrypt_general_learning_guard` are enabled.
- Re-read privilege matrix: `anon` and `authenticated` have no SELECT on shared `cb_*` content/events tables and no EXECUTE on `cb_search_chunks`, `cb_record_retrieval`, or `aria_memory.learning_context_for_goal`; `service_role` retains the required grants.
- Re-read `public.cb_search_chunks(text, integer)`: query predicate includes `d.metadata->>'privacy_class'='general'`; `public.cb_record_retrieval` stores only `[REDACTED: query content not retained]`.
- The new `aria_internal.autonomy_learnings.privacy_class` column is NOT NULL with default `unclassified`; its trigger rejects non-general writes. All 2,459 pre-existing learning rows remain `unclassified`.

### Synthetic database E2E — PASS
A single LIVE PostgreSQL DO block created only uniquely named synthetic records and removed them before completion. Assertions passed for:
- positive general-only results from `aria_memory.search_lexical`, `aria_memory.search_hybrid`, `aria_memory.learning_context_for_goal`, and public hybrid/learning wrappers;
- positive retrieval of a synthetic general chunk through `public.cb_search_chunks`;
- redaction of the original synthetic query from `cb_retrieval_events.query`;
- rejection of both `private` and `unclassified` writes to `aria_memory.memory_items`, `public.cb_documents`, `public.cb_memory_candidates`, and `aria_internal.autonomy_learnings`.
Post-test row-count reconciliation confirmed no synthetic E2E rows remained: memory items 19,019 (0 general), documents 8 (0 general), chunks 23, candidates 30 (all unclassified), learning rows 2,459 (all unclassified). This test changed no prior content or classification.

### Latest CI and live routes
- Dedicated CI [run 38653538194](https://github.com/Robvg9/aria-worker/actions/runs/38653538194): **9/9 contracts passed**, zero failed; all 14 configured Deno checks passed.
- Live Edge routes verified ACTIVE: Retrieval v101; Memory Write Gate v101; Memory v2 v110; Learning v2 v92; Learning v3 v93; Learning consolidator v1 v93; Device Gateway v269 (hash `40c44f5772586407e7cb1f96a5f5f23fa3a555b0146823bd668f0f2fb0902b94`); PWA API v3 v270; planners v7–v11; supervisors v6–v9. RobVG POST probes without authorization returned **401 on all 17 tested endpoints**.
- Source remediation is in draft PR [#1214](https://github.com/Robvg9/aria-worker/pull/1214), stacked on draft Step 4 PR #1213. It remains unmerged; do not claim main/PR/production have been fully reconciled.

### Remaining human gate — no false PASS
- No valid signed-in JWT or internal secret/cron token was used in this turn. Therefore authenticated Edge HTTP positive/negative content E2E is **still pending**; the SQL E2E does not substitute for that HTTP route test.
- Existing content remains intentionally unclassified and invisible to general retrieval: 19,019 canonical memories, 8 indexed documents, 30 candidates and 2,459 internal learning rows. Do not bulk classify these as `general` without review.
- **Decision:** database route-hardening is LIVE and tested; Step 5 remains **NOT SIGNED OFF 100%** until the valid-token HTTP E2E is run and data classification is deliberately reviewed. Step 6 remains responsible for historical query-retention review; Steps 6–8 and the global mission remain open.
