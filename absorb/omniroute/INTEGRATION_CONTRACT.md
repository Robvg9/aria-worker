# ARIA ABSORB — OmniRoute Gateway Adapter Contract v0.1

Status: DESIGN-ONLY / NOT ENABLED
Branch: absorb/omniroute-gateway-v1
Source: diegosouzapw/OmniRoute@23a11484862b3bb589a55e85b00e4ac53ffeb234

## Objective

Expose the external OmniRoute process to ARIA through the existing governed gateway boundary as the capability `omniroute.gateway`.

## Authority boundary

ARIA owns:
- planner and task intent
- capability selection
- authorization and Human Gate
- mission lifecycle
- verification
- evidence
- persistence
- learning

OmniRoute owns only:
- OpenAI-compatible gateway handling
- provider/model selection inside its allowed provider set
- translation
- fallback/resilience internal to the gateway
- inference transport

## Initial operations

- health
- models
- chat
- stream
- route

## Proposed local endpoint

`http://127.0.0.1:20128/v1`

The endpoint is a configuration target, not evidence of availability. It becomes selectable only after a real health probe succeeds.

## Required adapter behavior

1. Validate the normalized ARIA request through the existing MCP/Tool Gateway.
2. Preserve request_id, execution_id, authorization_id, tool_id and operation.
3. Never resolve or store provider secrets inside the adapter.
4. Never write ARIA mission state or canonical memory directly.
5. Normalize network/provider failures into ARIA failure semantics.
6. Attach provider/model/latency metadata as non-secret evidence.
7. Treat timeout, 429, 5xx, connection refused and malformed responses as failures.
8. Never promote an unverified response to mission success.
9. Keep live dispatch disabled until Phases 3-5 have passed.

## Activation gates

Phase 3: isolated installation PASS
Phase 4: standalone smoke PASS
Phase 5: OmniRoute -> Ollama -> Qwen LIVE PASS
Only then may implementation move to the runtime adapter in Phase 6.

## Explicit non-goals

This branch must not:
- replace ARIA Router v2
- replace Resource Intelligence
- replace Capability Registry
- replace Permissions/Human Gate
- replace Mission Runtime
- expose OmniRoute as globally available before verification
- copy OmniRoute SQLite state into ARIA canonical state

## Definition of ready-for-code

Once Phases 3-5 are green, implement the adapter behind the existing `mcp-gateway/dispatch.js` injected-adapter contract and add focused unit/contract tests before any integration merge.
