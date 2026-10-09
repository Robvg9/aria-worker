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


## Implementation checkpoint — PR #1074 / 2026-10-09

### Frontend binding
- The BattleCruiser project card embeds the actual production URL `https://battlecruiser.robvg9.workers.dev/` in ARTIA with `previewMode='auth-required'`; the dashboard is not claimed verified without a real BC session.
- Independent HTTP probe from RobVG confirmed `/`, `/app.js`, and `/js/core.js` return HTTP 200, and the frontend configuration points at `papxnkkjtkxsitcsvcme`.
- Response headers from the live app did not include `X-Frame-Options` or a CSP header in that probe. This is a useful embed check, **not yet a real-browser ARTIA E2E certification**.
- The PWA provides direct links to frontend LIVE, repository `main`, and the original Supabase dashboard.

### Backend user-session binding (read-only)
- ARIA's Projects surface can sign in directly against the BC Supabase Auth endpoint, with the BC email/password; credentials and tokens do not pass through the ARIA App API, and the token is kept in page memory only.
- A verified BC access token is bound to the active ARIA user's JWT subject and is cleared when the workspace unmounts / the connection is closed. It is attached only to BC project chat, mission intake and BC mission-list requests.
- The App API validates that the frontend still points to the expected backend and verifies the BC Auth user. For chat/missions it may include a bounded, read-only snapshot via the signed-in user's own permissions: `perfil_usuario_actual`, `permisos_usuario_actual`, `listar_turnos`, `bc_listar_turnos_maestros_home` and a seven-day `reporte_ventas`. RPC failures remain unavailable; they are not bypassed.
- Live public probe of `obtener_email_login_por_nombre` with an invalid, synthetic username returned HTTP 401 / SQLSTATE `42501 permission denied for function`. The login UI therefore requires the user's **email**, not a public username lookup. No anonymous grants were added.
- The integration is read-only and user-scoped. It does not provide admin credentials, arbitrary CRUD, schema changes, unrestricted SQL, or management-plane access.

### CI and release gate
- PR: https://github.com/Robvg9/aria-worker/pull/1074
- Branch: `feat/battlecruiser-full-project-binding-20261009`
- Current integration is **not merged or deployed**. The PR remains draft while GitHub Actions checks execute.
- No BattleCruiser SQL/migrations were run, no BC business data was mutated, no new Supabase project was created, and ARIA's own Supabase connection remains untouched.

### Remaining closure criteria
1. GitHub CI PASS for the exact final PR head.
2. Merge through normal governance and deploy the exact reviewed SHA.
3. In ARIA Projects, connect using a real, authorized BattleCruiser email account (never paste the password into ChatGPT).
4. Verify the embedded LIVE frontend in a real browser.
5. Verify BC Auth session, profile and permission RPCs; verify turn and report RPC results under that user's real permissions.
6. Send a BattleCruiser-specific chat request and enqueue a non-mutating verification mission; confirm the same project ID and read-only snapshot appear in mission metadata.
7. For true administrator / unrestricted backend control, add a separately authorized server-side management integration for the existing BC project. This is impossible to certify from the current ChatGPT Supabase connector because it can manage only ARIA's project. Do not substitute ARIA's backend or grant public access.
