# ARIA Worker — Adapter Layer + Control Plane

Current package version: **2.5.7**.

This repository contains ARIA's governed control-plane, execution adapters, autonomous layers and the real-activation integration runtime. Architecture completion does not imply that every external account is configured or that production operations have been executed.

## Cloudflare Worker deployment

The repository is the source of truth for the `aria` Cloudflare Worker. `wrangler.toml` declares `worker.js` as the Worker entrypoint, so the configured Cloudflare GitHub deployment runs `npx wrangler deploy` against the repository Worker source.

