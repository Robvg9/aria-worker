# ARIA Universal Multi-IA Adapter Contract v1.0.0

Mission 9.6. Interface layer only. Memory plane is unchanged.

```
Claude ─┐
ChatGPT─┤
Grok ───┤  MCP (same tools)
Gemini ─┤
otras ──┘
        ↓
       ARIA
        ↓
   ChatBending
        ↓
CAPTURE → GATE → COMMIT → SYNC
```

## Universal MCP

| Campo | Valor físico verificado 2026-09-01 |
|---|---|
| Resource | `https://aria.robvg9.workers.dev` |
| Health | `GET /` → `ARIA MCP Gateway ONLINE` |
| MCP | `POST /mcp` — 401 sin Bearer |
| Auth | OAuth 2.1 + PKCE |
| Authorization server | `https://icuqsstxfdbvjytkhlog.supabase.co/auth/v1` |
| Tools | `aria_context`, `aria_memory_capture` |

## CONTEXT

```
{ "query": string }   // required, minLength 1
```

Read-only. Retrieval sobre ChatBending. No escribe memoria.

## MEMORY CAPTURE

```
{
  "message": string,                    // required
  "source_application": string,         // grok | claude | chatgpt | gemini | mistral | aria | aria_app | unknown | slug
  "source_conversation_id": string,     // optional
  "source_session_id": string,          // optional
  "idempotency_key": string             // optional; required for safe retries
}
```

Respuesta observada:

```
{ "status": "accepted", "candidate_id": uuid, "canonical_write": false, "review_required": true }
```

Replay idéntico: `idempotent_replay: true` + mismo `candidate_id`.
Misma key, payload distinto: `idempotency_conflict`.

## Identidad de origen

`source_application` identifica la IA. **No selecciona pipeline.**
No existen tablas, writers ni CAPTURE por IA.

Canonical IDs: `grok`, `claude`, `chatgpt`, `gemini`, `mistral`, `aria`, `aria_app`, `unknown`.
Aliases viven en `registry.json`. Un slug no registrado se acepta como identidad, no como cerebro nuevo.

## Guardas

- ARIA nunca aprueba memoria.
- `pending ≠ approved ≠ committed`.
- GATE humano obligatorio.
- BattleCruiser fuera de alcance.

## Cómo añadir una IA nueva

1. Registrar el cliente MCP contra la misma URL.
2. Completar OAuth 2.1 + PKCE.
3. Llamar `aria_context` / `aria_memory_capture`.
4. Enviar `source_application` canónico.
5. No crear memoria paralela.
