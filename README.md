# ARIA Worker — Adapter Layer + Control Plane

Current package version: **2.5.8**.

This repository contains ARIA's governed control-plane, execution adapters, autonomous layers and the real-activation integration runtime. Architecture completion does not imply that every external account is configured or that production operations have been executed.

## Cloudflare Worker deployment

The repository is the source of truth for the `aria` Cloudflare Worker. `wrangler.jsonc` declares `worker.js` as the Worker entrypoint, so the configured Cloudflare GitHub deployment runs `npx wrangler deploy` against the repository Worker source.

## Cloudflare administration boundary

The Worker exposes `/admin/cloudflare` for authenticated internal inspection of the `aria` Worker. It requires the existing `ARIA_RUNTIME_SHARED_SECRET`, `CLOUDFLARE_API_TOKEN`, and non-secret `CLOUDFLARE_ACCOUNT_ID` bindings. Secrets are never accepted from request bodies, logged, or returned.

Supported read operations are `worker`, `deployments`, `content`, and `settings`. Code changes should continue to flow through the GitHub source-of-truth and Cloudflare Git deployment path rather than directly mutating production state from an ad-hoc public endpoint.
