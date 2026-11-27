# ARIA Optima — Agent Tool-Loop Budget Enforcement v1

## Scope

Every provider inference turn made by aria-agent-runtime-v1/tool-loop.ts is submitted to aria-execution-runtime-v1. The loop no longer reads Google/OpenRouter provider credentials or sends inference requests to those provider endpoints directly.

Each model turn, including the final report turn, creates a unique mission_id:step_id:nonce request ID. The central runtime validates mission context, reserves the mission ledger, reserves provider/account quota, dispatches the provider request, and settles the outcome as succeeded, failed, or unknown.

## Function calling

- OpenRouter requests carry normalized Chat Completions messages, tools, and tool_choice.
- Gemini requests carry native contents, functionDeclarations, and function-calling configuration.
- Provider responses are normalized into content and tool_calls; Gemini raw parts are retained between turns to preserve thought-signature continuity.
- Provider-quota denial may move to an alternate route only when the central runtime has confirmed that the reservation was released before any inference POST. Any mission_budget_* error, including uncertain settlement, is terminal for the turn and forbids fallback.

## Write authorization

Repair/write tool loops require LOW_RISK_WRITE, an explicit human_gate_required policy, and verified Human Gate fields. The authorization and gate proof are forwarded to the central runtime on every inference turn. GitHub tool actions remain limited to the pre-existing allowlisted operations and non-main repair branch.

## Safety state

- MISSION_EXECUTION_PAUSED=true remains enabled in both agent and execution runtimes.
- Gate 3 remains read-only and cannot dispatch tools.
- No LIVE migration, provider call, production deployment, secret mutation, cron activation, or real mission was performed by this change.
- The integration contract is not a production or physical E2E certificate. A bounded, separately approved pilot is still required after the PR chain is merged and deployed.


## Mock E2E del cliente presupuestado — 2026-11-27

- Se extrajo la construcción de inferencias a `budgeted-model-client-v1.mjs`, inyectable por `fetchImpl`; el runtime real usa el mismo caller que ejerce el test.
- Test dinámico `tests/agent-tool-loop-budgeted-model-client-v1.test.js`: Gemini turn 1 + función; turno 2 con preservación exacta de `gemini_parts`/thought signature y respuesta de herramienta; turno final; OpenRouter con envelope de function calling; request IDs únicos `mission:step:nonce`; misión/paso obligatorios; Human Gate fail-closed; errores `mission_budget_*` terminales; y clasificación de fallback.
- Todas las respuestas proceden de un `fetchImpl` local simulado. No hay red, credenciales reales, POST a proveedor ni acceso a Supabase.
- El test se registra en `npm test` y en el catálogo PWA.


## Delegación directa sin herramientas — respuesta interna perdida

La ruta normal del agente (sin tool-use) también usa un guard al llamar a `aria-execution-runtime-v1`. Un fallo de transporte después del posible despacho, un cuerpo ilegible/vacío, una respuesta sin el contrato de estado o un HTTP 5xx sin código presupuestario estructurado se convierten en `mission_budget_execution_runtime_outcome_unknown` y HTTP 423. Así el mission runner no puede interpretar el fallo como recuperable ni probar otro agente/proveedor.

Los errores `mission_budget_*` estructurados del runtime se preservan. Los errores conocidos con cuerpo legible mantienen su clasificación normal. El test `AGENT DIRECT EXECUTION RUNTIME RESPONSE-LOSS GUARD` simula red perdida, body truncado, respuesta vacía, HTTP 502 ambiguo, budget block conocido y fallo de proveedor legible; no usa red ni credenciales reales.
