# ARIA Worker — Adapter Layer + Control Plane

Current package version: **2.6.9**.

This repository contains ARIA's governed control-plane, execution adapters, autonomous layers and the real-activation integration runtime. Architecture completion does not imply that every external account is configured or that production operations have been executed.

## Cloudflare Worker deployment

The repository is the source of truth for the `aria` Cloudflare Worker. `wrangler.jsonc` declares `worker.js` as the Worker entrypoint, so the configured Cloudflare GitHub deployment runs `npx wrangler deploy` against the repository Worker source.

## Cloudflare administration boundary

The Worker exposes `/admin/cloudflare` for authenticated internal inspection of the `aria` Worker. It requires the existing `ARIA_RUNTIME_SHARED_SECRET`, `CLOUDFLARE_API_TOKEN`, and non-secret `CLOUDFLARE_ACCOUNT_ID` bindings. Secrets are never accepted from request bodies, logged, or returned.

Supported read operations are `worker`, `deployments`, `content`, and `settings`. Code changes should continue to flow through the GitHub source-of-truth and Cloudflare Git deployment path rather than directly mutating production state from an ad-hoc public endpoint.

## Android PWA chat dictation (QA contract)

The Android-hosted PWA chat microphone is transcript-only. It calls the ARIA native on-device recognizer with an explicit, bounded utterance; chat dictation must never fall back to a WebM attachment or a remote/browser speech service when hosted inside the Android shell.

For a regional Spanish locale unavailable in Android's offline recognizer, the PWA may retry once with the general Spanish locale `es-ES`. The result is accepted only when Android reports that exact locale and `recognitionMode=on_device`. The chat feedback must disclose the locale fallback. If the general Spanish model is unsupported or not downloaded, show a clear action message and do not send audio elsewhere. Cancellation always wins and must prevent a pending language fallback from starting.

On narrow chat layouts, dictation feedback belongs in the composer flow as a full-width row, not an absolutely positioned popover outside the panel. This keeps recognition errors and status text visible above the panel's lower edge.
