# ARIA Block B — Concrete Tool Execution Contract

## Purpose

Block B makes the already-approved execution path operational through a concrete, injected credential resolver and the first real provider adapter path. It does not redefine routing, fallback, governance, memory authority, or the tool/MCP gateway.

## B1 — Credential Resolver

`createCredentialResolver({ getSecret })` accepts only `secret://<provider>/<account>` references and delegates resolution to an injected secret-store function.

The resolver must not:

- read `process.env`;
- read local files;
- access a database or network directly;
- log secrets;
- persist secrets;
- expose backend exception text.

A successful resolution returns a transient secret to the immediate execution caller only. A Cloudflare-compatible binding implementation maps a canonical reference to a binding name supplied by configuration; the binding value itself is never committed to source control.

## B2 — Provider Adapter

The first concrete adapter is `openrouter_chat_completions`.

The adapter receives `{ route, input, secret, transport }`, translates `text_generation` input to OpenRouter Chat Completions, and normalizes the provider response.

It must perform exactly one provider call. It must not retry, choose another account, select another model, invoke fallback, or write memory.

## B3 — Execution Wiring

10.8 remains the final execution boundary:

`10.6 Router → 10.7 Fallback → 10.12 Governance → Credential Resolver → Adapter → Provider API`

Before the adapter is called:

1. route is present and has a canonical status;
2. 10.7 `candidateSelectable` accepts the route;
3. governance authorization is explicitly `approved`;
4. account supplies a canonical `credential_ref`;
5. CredentialResolver successfully resolves the reference.

The resolved secret is never included in `ExecutionResult`, errors, or observability events.

## B4 — Safety / Verification

- Test transports are injected and do not contact the provider.
- Tests use synthetic secret material only.
- Existing Block A tests remain in the complete `npm test` sequence.
- The Block B suite covers sync/async resolution, invalid references, secret non-leakage, binding resolution, adapter translation/normalization, end-to-end execution, provider failure, and single-attempt behavior.
- Actual production provider execution is not part of CI because no production secret is committed or automatically provisioned.

## LIVE activation boundary

The engine may use the real transport only when the caller supplies a successfully resolved credential through the injected resolver. Live provider execution remains outside automated tests and requires an explicitly provisioned production credential under the existing governance controls.
