# ARIA Cloudflare Credential Manager

The credential manager uses a runtime-secret-protected endpoint and predefined token templates. It never stores secrets in Git.

Supported templates: worker_deploy (Workers Scripts Write) and worker_read (Workers Scripts Read), scoped to the configured Cloudflare account.
