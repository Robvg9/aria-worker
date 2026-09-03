# ARIA Connector Layer

Provider-specific adapters are intentionally thin. They expose normalized capability metadata and accept credential references only; secret material never enters the Tool Universe registry or connector interface.

Initial connector targets:
- GitHub
- Supabase
- Cloudflare
- Notion / ChatBending
- Web research
- Image generation

Connector adapters do not bypass the Tool Router, Permission Resolver, Gateway, Human-Gate, or Execution Engine.
