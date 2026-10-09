# ARIA ↔ BattleCruiser Project Binding V1

Date: 2026-10-09
Status: implementation contract / first integration step, not full backend certification.

## Canonical resources

- Git repository: https://github.com/Robvg9/battlecruiser
- Source branch: main
- Production frontend: https://battlecruiser.robvg9.workers.dev/
- Supabase project ref: papxnkkjtkxsitcsvcme
- Supabase API: https://papxnkkjtkxsitcsvcme.supabase.co
- Supabase Dashboard: https://supabase.com/dashboard/project/papxnkkjtkxsitcsvcme

The ARIA Supabase project `icuqsstxfdbvjytkhlog` remains exclusively ARIA's own backend and must never be substituted for BattleCruiser.

## Required ARIA project behavior

1. Project chat and mission intake must receive these canonical resource identifiers as server-owned context (not trust a client override).
2. Project UI should offer direct links to the LIVE app, the canonical source repository, and the correct Supabase project.
3. ARTIA's existing BattleCruiser view remains a static source reference unless the user explicitly selects the actual LIVE app. Never label the source mock as LIVE.
4. Frontend/repository access and backend data access are separate capabilities. A live URL or successful Auth health probe is not proof that protected rows/RPCs are accessible.
5. Protected backend access must use a separately configured, least-privilege server-side role/credential. Never expose privileged credentials in browser code, chat, logs, source control, or the ARIA Supabase project's credentials.
6. Do not grant `anon` access just to suppress a permission error. Use an authenticated BattleCruiser user JWT for normal app-level operations or a specifically authorized read-only server credential for diagnostics.
7. Read-only introspection of the actual BC project must precede any SQL change. Backend mutations and production deploys require explicit gates and evidence.
8. Definition of full connection: repository metadata + LIVE frontend reachability + correct backend identity + authenticated read/write E2E appropriate to each capability + persisted evidence. Resource links alone do not close the integration.

## Current verified facts (2026-10-09)

After the owner resumed the paused Supabase project:
- `papxnkkjtkxsitcsvcme.supabase.co` resolved through independent DNS resolvers.
- `/auth/v1/health` returned HTTP 200.
- An unauthenticated GET to protected `public.turnos` returned PostgreSQL permission error `42501`, which is not proof of downtime; it must be tested with the appropriate authenticated context.
- ChatGPT's currently authorized Supabase management connection lists only the ARIA project and denies management access to the BC project. This connector limitation must not force disconnecting ARIA from its own Supabase.
- No new Supabase project was created and no migration or production data mutation was performed.

## Implementation sequencing

A. Register canonical resources in the ARIA Project Workspace and server-owned project context.
B. Validate the exact resource identifiers reach chat and mission metadata.
C. Add a backend adapter using a scoped credential without changing ARIA's own backend connection.
D. Validate read-only identity/introspection against BC LIVE, then authenticated user-level operations.
E. Add write operations only through approved, auditable capabilities and prove E2E.
