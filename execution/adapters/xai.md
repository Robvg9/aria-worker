# xAI / Grok Provider Adapter

**Adapter ID:** `xai_responses`  
**Provider ID:** `xai`  
**Endpoint:** `https://api.x.ai/v1/responses`  
**Operation:** `text_generation`

## Role

Additive provider adapter for the ARIA Execution Engine (10.8). Same contract as OpenRouter and Google Gemini Direct:

```js
execute({ route, input, secret, transport }) → { ok, response, usage } | { ok: false, error }
```

Does **not** route, retry, fall back, resolve credentials, or write memory.

## Registry entries

| Layer | ID |
|---|---|
| Model | `xai/grok-4.6` |
| Account | `acct_xai_primary` |
| Credential ref | `secret://xai/acct_xai_primary` |
| Capability | `text_generation` (verified) |
| Quota/capacity | `available` (numeric limits unknown) |

## Request shape

- `input.payload.messages[]` or `input.payload.prompt` or `input.payload.input`
- Optional: `temperature`, `max_tokens` / `max_output_tokens`
- Optional Remote MCP tools:

```json
{
  "tools": [
    {
      "type": "mcp",
      "server_url": "https://aria.robvg9.workers.dev/mcp",
      "server_label": "aria",
      "authorization": "Bearer <governed-token>"
    }
  ]
}
```

`authorization` must already be a governed token resolved outside this adapter. The adapter never reads env vars or secret stores.

## Security

- XAI API key only via CredentialResolver → `secret` argument.
- Secret and MCP authorization never appear in ExecutionResult, events, or logs.
- Grok Web Custom Connector (`integrations/grok/`) is untouched and independent.

## Tests

```bash
node tests/xai-adapter.test.js
```

Covered: request construction, Bearer auth, response/usage normalization, 401/429/5xx/timeout, MCP tool inclusion, secret non-leakage, credential_unavailable, provider mismatch.

## Live smoke (controlled)

Requires `secret://xai/acct_xai_primary` bound in the production credential store. Not run in CI.

1. ARIA → xAI → Grok (text only)
2. ARIA → xAI → Grok → Remote MCP → `aria_context` (read-only tool)

Do not use `aria_memory_capture` in the initial smoke.
