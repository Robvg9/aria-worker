# OmniRoute Phase 4 — Standalone Smoke Contract

Status: PASS — HOSTED WINDOWS CERTIFIED

## Purpose
Define the standalone certification that must pass after Phase 3 installation and before any ARIA runtime adapter work.
The phase verifies OmniRoute as an independent service. It must not depend on ARIA mission state, ARIA Supabase persistence, ARIA permissions, or an ARIA router.

## Required checks
1. Liveness: GET /api/health returns HTTP 200.
2. Readiness: GET /api/health/ping returns HTTP 200.
3. OpenAI compatibility: GET /v1/models returns HTTP 200 and a non-empty data array.
4. Management auth boundary: unauthenticated GET /api/keys is rejected; invalid bearer credentials are rejected.
5. Non-streaming chat completion: valid API key, explicit smoke model, HTTP 200, non-empty assistant content.
6. Streaming chat completion: valid API key, explicit smoke model, text/event-stream, at least one usable content delta, terminal [DONE] frame.
7. Status endpoint responds successfully without executing an upstream request.
8. Persistence/restart: the same data directory survives stop/start and health/models recover after restart.

## Credentials and provider boundary
Phase 4 must not copy ARIA provider credentials into OmniRoute.
The smoke model/provider must be explicitly supplied to the standalone environment. When no provider credential or smoke model is available, the phase remains NOT CERTIFIED.

## Runner
scripts/absorb/omniroute-phase4-standalone-smoke.mjs
Required environment: OMNIROUTE_BASE_URL (default http://127.0.0.1:20128), OMNIROUTE_API_KEY, OMNIROUTE_SMOKE_MODEL.
The runner writes a bounded JSON receipt under the Phase 4 sandbox.

## Gate
Phase 4 becomes PASS only when the isolated service has passed health, readiness, models, authentication negative cases, non-stream chat, streaming chat, status, and restart/persistence checks.
A static test, successful process start, or non-empty models catalog alone is not Phase 4 PASS.

Until the full standalone smoke receipt exists: Phase 4 — STANDALONE SMOKE = PASS — HOSTED WINDOWS CERTIFIED.

## Current certification evidence (2026-10-05)
- Phase 3 Hosted Windows: GitHub Actions Run `37199350410` → SUCCESS.
- Phase 4 Standalone Hosted Windows: GitHub Actions Run `37199350438` → SUCCESS, including restart/persistence verification.
- Phase 5 Hosted real Ollama→Qwen: GitHub Actions Run `37242957331` → SUCCESS.
- Exact OmniRoute source: `diegosouzapw/OmniRoute` commit `3e66ff2e8cc94821b093fe57dad667b585230cd1`, version `3.8.52`.
- Runtime activation remains disabled in SOURCE_LOCK; certification artifacts do not promote OmniRoute into ARIA authority.
