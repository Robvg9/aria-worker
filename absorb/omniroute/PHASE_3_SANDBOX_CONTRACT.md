# OmniRoute Phase 3 — Windows Sandbox Contract

Status: PASS — HOSTED WINDOWS CERTIFIED

## Purpose

Prepare one reproducible Windows execution path for Phase 3 without enabling any OmniRoute runtime inside ARIA.

The sandbox must be completely isolated from ARIA's canonical runtime, state, secrets, cache and ports.

## Fixed source

- Repository: \`diegosouzapw/OmniRoute\`
- Ref: \`release/v3.8.52\`
- Commit: \`3e66ff2e8cc94821b093fe57dad667b585230cd1\`
- No \`latest\` or floating ref is allowed.

Phase 3 may use either an exact commit-addressed source checkout or an exact commit-addressed archive. The hosted Windows gate uses an exact Git checkout and verifies the commit before installation.

## Windows isolation floor

Default sandbox root:

\`D:\ARIA-Windows-Agent\Sandbox\OmniRoute-v3.8.52\`

The runner keeps these resources inside that root:

- source tree
- SQLite/data directory
- npm cache
- local capture metadata

The server is explicitly bound to loopback:

\`HOST=127.0.0.1\`

Ports are pinned to the OmniRoute default:

- \`PORT=20128\`
- \`DASHBOARD_PORT=20128\`
- \`API_PORT=20128\`

No ARIA Supabase database, ARIA credentials or ARIA mission state are imported.

## Execution

Script:

\`scripts/absorb/omniroute-phase3-sandbox.ps1\`

Preview only:

\`powershell -NoProfile -File scripts/absorb/omniroute-phase3-sandbox.ps1\`

Execute the sandbox installation/start/health/stop sequence:

\`powershell -NoProfile -File scripts/absorb/omniroute-phase3-sandbox.ps1 -Run\`

The certification sequence:

1. validates the expected Node major/minor range;
2. creates the isolated sandbox directories;
3. downloads the exact locked source archive;
4. extracts only into the sandbox;
5. runs \`npm ci\` with an isolated npm cache;
6. builds the exact source tree;
7. starts OmniRoute directly with loopback binding;
8. probes \`GET /api/health\`;
9. records source identity and installation/build/health evidence;
10. stops the spawned process tree.

## Fail-closed behavior

The certification must stop without declaring Phase 3 PASS when:

- the locked archive cannot be downloaded;
- Node is outside the supported range;
- \`npm ci\` fails;
- the build fails;
- the server does not become healthy;
- the expected process cannot be stopped cleanly.

A network/download failure is classified as an environment blocker, not as a successful OmniRoute installation.

## Gate

Phase 3 becomes PASS only after a real Windows execution produces:

\`install → isolated start → /api/health = 200 → isolated stop\`

with capture metadata available and no ARIA state changes.

Until that evidence exists, the status remains:

**Phase 3 — SANDBOX = BLOCKED / NOT CERTIFIED.**