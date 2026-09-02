# ARIA — Block B Completion

**Objective:** make the tool-execution data plane real enough to execute a governed provider call without moving secrets into the repository or bypassing any control-plane authority.

## Scope executed in this PR

### B1 — Concrete Credential Resolver
- Canonical refs remain `secret://<provider>/<account>`.
- Resolution is dependency-injected through `getSecret(ref, context)`.
- No `process.env`, filesystem, database, network, or registry reads are performed by the resolver.
- Cloudflare-compatible bindings are supported through explicit non-secret ref→binding-name mapping.
- Resolver failures are normalized to safe fixed error codes; provider/vendor exception text is not exposed.
- Secret material is transient and returned only to the immediate execution path.

### B2 — Provider Adapter Execution
- Existing `openrouter_chat_completions` adapter is exercised as the first concrete provider adapter.
- Adapter receives the resolved secret only for the outbound Authorization header.
- Payload translation and response normalization remain provider-specific.
- Adapter performs exactly one request and never retries, falls back, rotates accounts, or writes memory.

### B3 — Execution Wiring
- Execution Engine now awaits synchronous or asynchronous CredentialResolver implementations.
- Existing route validation, 10.12 authorization gate, 10.7 candidate gate, quota/capacity evidence, adapter registry, and one-attempt behavior remain intact.
- The real HTTP transport remains the default transport, while tests inject a controlled transport.
- `metadata.mode = live` is still reached only when the production default transport and a successfully resolved credential are both present. This PR does not perform an uncontrolled live provider call.

### B4 — Verification / Regression
- `tests/block-b.test.js` covers canonical resolution, invalid refs, resolver-error non-leakage, binding resolution, adapter request/response behavior, end-to-end execution, provider error sanitization, and async resolver waiting.
- `npm test` includes the Block B suite after all pre-existing suites.

## Security invariants

- No real secret values are committed.
- No secret is returned in execution results or observability events.
- No secret is written to registries or persistent storage.
- `selected` does not bypass `approved`.
- `unknown` quota/capacity is never promoted to `available`.
- No retry, fallback, account hopping, or quota bypass is introduced.
- No canonical memory writes are introduced.
- No BattleCruiser changes are introduced.

## PR acceptance gate

Merge only when:
1. GitHub Actions executes the complete `npm test` suite successfully.
2. Diff review confirms scope is limited to Block B runtime/resolver/test/documentation changes.
3. No secret-like material is present in changed source/docs/tests except intentionally synthetic test fixtures.
4. No regressions appear in the existing Block A and Stage 10/11 suites.
5. The PR remains single-purpose and does not activate an uncontrolled live provider request.
