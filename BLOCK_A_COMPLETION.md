# ARIA — Block A Completion

## Scope
Block A closes the tool-control foundation required before live adapters:

1. Credential / Secret Boundary (A1)
2. Persistent Human Approval Store (A2)
3. Health / Availability observation boundary (A3)

## A1 — Credential Boundary
- Canonical credential references use `secret://<provider>/<account>`.
- Raw secrets are rejected at the boundary.
- No environment-variable access.
- Resolution is dependency-injected and occurs only after upstream authorization.
- Secrets are passed only to the injected transport callback and are never returned as application data, logs, errors, registries, or events.
- Concrete secret-store selection remains outside this package; this repository owns the boundary contract, not secret custody.

## A2 — Persistent Human Approval Store
- Durable table: `aria_internal.execution_approvals`.
- RLS enabled; `anon` and `authenticated` have no table privileges; `service_role` is the operational boundary.
- Approval is bound to request, execution, tool, operation, risk class, target, and policy version.
- New approvals start `pending`; only explicit decisions can transition them.
- `HIGH_RISK_WRITE` and `DESTRUCTIVE` approvals require a non-secret verification reference.
- Stored records are revalidated before execution decisions are honored.
- Expired, rejected, revoked, malformed, mismatched, or insufficiently verified approvals fail closed.
- Migration is version-controlled at `supabase/migrations/20260902_block_a_approval_store.sql`.

## A3 — Health / Availability
- Health remains evidence, not authorization.
- Unknown is the default and is never promoted by inference.
- Observation is dependency-injected.
- HTTP observation permits only HTTPS `GET`/`HEAD`, has bounded timeouts, and normalizes status into health/availability evidence.
- Health code does not route, fall back, resolve credentials, execute providers, or write memory.

## Verification policy
- `npm test` is the full repository regression suite.
- Block A has a dedicated cross-layer integrity suite.
- Live database state is verified separately against the production ARIA Supabase project.
- No real credential value is stored in the repository or approval table.
- No live provider execution is activated by Block A.
