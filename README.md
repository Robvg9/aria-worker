# ARIA Worker — Adapter Layer

`aria-adapters-v1.0.0` · Misión 9.6

Fuente persistente de la **capa de interfaz multi-IA**. No es un cerebro de memoria.

El runtime vivo permanece en Cloudflare (`aria.robvg9.workers.dev`) + Supabase ARIA. Este repositorio conserva el contrato de adapters para que añadir Claude / ChatGPT / Gemini / otras IAs no requiera otro pipeline.

## Qué es

```
IA externa → Adapter (auth/protocolo) → ARIA MCP → ChatBending
                                          ↓
                           CAPTURE → GATE → COMMIT → SYNC
```

## Qué no es

- No escribe Notion.
- No aprueba candidatos.
- No crea `cb_memory_*` por IA.
- No toca BattleCruiser.

## Archivos

- `adapters/contract.md` — contrato universal
- `adapters/registry.json` — IAs, aliases, recetas de conexión
- `adapters/normalize.js` — canonicalización de `source_application`
- `tests/normalize.test.js` — pruebas locales

```
node tests/normalize.test.js
```

## Estado 2026-09-01

| IA | Cliente real | Pipeline |
|---|---|---|
| Grok | conectado y E2E | mismo |
| Claude | pendiente registro del conector | mismo |
| ChatGPT | pendiente registro del conector | mismo |
| Gemini | pendiente registro del conector | mismo |

El MCP ya acepta `source_application` para cualquier IA. Conectar un cliente nuevo es configuración, no un sistema de memoria.
