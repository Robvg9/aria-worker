# ARIA Optima — Mission Token Preflight Bound v1

## Runtime contract

The mission budget reservation records a preflight token bound only when the provider adapter has an explicit output-token ceiling:
- Google Gemini Direct: `generationConfig.maxOutputTokens`
- OpenRouter Chat Completions: `max_completion_tokens` (or `max_tokens`)
- xAI Responses: `max_output_tokens` (or `max_tokens`)

The value is calculated from the exact JSON request payload as:

`2 × UTF-8 payload bytes + explicit output-token ceiling + 256 framing tokens`.

This is a deliberately conservative preflight heuristic, not a provider tokenizer, actual usage, or billing amount. It can reject early due to over-estimation. A provider without an explicit output cap, unsupported route, invalid or unserializable payload remains `NULL`; a mission with a token ceiling then fails closed. Provider-reported input/output/total token usage is still settled separately after the call.

## Monetary boundary

No USD prices or currency are inferred. `p_estimated_cost_amount` and `p_currency_code` remain `NULL` until an observed, verified provider price source is wired into the same exact route/account/model identity. Any policy requiring a cost ceiling therefore continues to fail closed.

## Safety

The helper is pure and has no secrets, no network access, and no provider calls. No live migration, policy row, deploy, mission, or unfreeze is performed by this change.
