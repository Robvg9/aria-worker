# BLOCK 3/9 — REAL CONNECTORS

Version: 1.7.0
Status: IMPLEMENTED — pending audit/CI/merge gate.

Missions 3.1–3.7 are represented by a canonical connector registry and provider adapter boundary:

- 3.1 GitHub: repository/code/branch/PR/workflow operations contract.
- 3.2 Supabase: database/migration/Edge Function/log operations contract.
- 3.3 Cloudflare: Worker/config/deploy/log operations contract.
- 3.4 Notion / ChatBending: page/search operations contract.
- 3.5 Web Research: search/fetch operations contract.
- 3.6 Workspace Filesystem: read/write/list operations contract.
- 3.7 Image Generation: generate/edit operations contract.

Safety contract:
- No provider credential values are stored in connector metadata.
- Adapters accept canonical credential references only.
- Transport is injected; the connector layer does not invent credentials or bypass governance.
- Connector registration does not imply connection or availability.
- Real execution remains downstream of Router, Permission Resolver, Gateway, and Governance.
- Grok/Multi-IA remains paused and outside the critical path.

Verification: `tests/block-3-real-connectors.test.js`.
