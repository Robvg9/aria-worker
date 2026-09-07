# ARIA Computer Use v1 Contract

## Purpose

Computer Use is a governed perception/action layer, not a coordinate macro system.

Canonical loop:

`PERCEPTION → UI STATE → ACTION PLANNING → EXECUTION → OBSERVATION → VERIFICATION → RECOVERY → LEARNING`

## UI state

A UI snapshot is normalized into semantic nodes with stable ids, role, name/text/label, visibility, enabled state, parent relation and safe metadata. Secret-shaped material is rejected at ingestion.

## Element resolution

`findElement()` resolves by semantic context (`role`, `name`, `text`, `label`, optional attributes). A missing match is `element_not_found`; multiple matches are `element_ambiguous`. Ambiguity fails closed.

## Actions

Supported actions are `navigate`, `click`, `type`, `press`, `scroll`, `select`, and `wait`. Every action has a stable id, risk classification and optional semantic target/expectation.

## Execution boundary

The runtime never owns a browser implementation. It consumes an injected adapter exposing:

- `observe(context)` → normalized UI state
- `execute({mission_id, action})` → terminal result and optional resulting UI state

This keeps provider/browser/device transport replaceable and prevents provider-specific protocol from leaking into the cognitive layer.

## Governance

`read` and `low_risk_write` may execute through the existing authorization boundary. `high_risk_write` and `destructive` require an explicit approved authorization object. Secret material is rejected and never returned in results or lessons.

## Verification

An action is successful only when the executor succeeds **and** the post-action state satisfies the declared expectation. Expectations can assert URL, title, required/forbidden elements and observed body text.

## Recovery

Recovery is bounded to two additional observations/retries. Recovery may re-observe and retry the semantic plan; it may not invent an unrelated action. Exhaustion returns a controlled terminal status.

## Learning 2.0 boundary

Successful verified actions emit a reusable lesson candidate; failed planning/execution/verification emits diagnostic evidence. Persistence is injected and therefore remains outside the Computer Use executor.

## Security constraints

The runtime has no direct credential lookup, environment access, browser-network authority, or secret store authority. It receives only already-authorized transport results. Any secret-shaped material detected in state/action/lesson payloads fails closed.

## Compatibility

Computer Use v1 is additive and leaves the existing execution engine, device dispatcher, Universal Executor, router, fallback, Self-Model and World Model contracts intact.
