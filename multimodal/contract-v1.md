# ARIA Multimodal + Voice v1 Contract

## Purpose

Multimodal perception is a governed cognition input layer, not a collection of direct provider calls.

Canonical loop:

`PERCEPTION → STRUCTURED STATE → COGNITION`

For interactive media:

`CAPTURE → PERCEPTION → NORMALIZATION → STRUCTURED STATE → COGNITION → OPTIONAL OUTPUT`

## Modalities

Supported canonical modality ids:

- `voice_input`
- `voice_output`
- `image`
- `screenshot`
- `camera`
- `document`
- `audio`

Each modality must enter through an injected adapter. The core does not access microphones, cameras, files, browsers, or external model APIs directly.

## Structured state

Every accepted perception becomes a canonical object containing:

- `modality`
- `content_type`
- `source_ref`
- `observations`
- `entities`
- `transcript` when applicable
- `document_text` when applicable
- `ui_state` for screenshots
- `confidence`
- `provenance`
- `sensitivity`
- `metadata`

Unknown values remain explicit as `null`/`unknown`; the normalizer never invents facts.

## Security

Secret-shaped content, credential material, access tokens, private keys, or raw authentication material is rejected at normalization. Raw media bytes are never persisted by the multimodal core.

## Cognition boundary

The multimodal runtime emits only structured state to an injected cognition callback. The callback may return a plan/decision, but the multimodal layer has no execution authority.

## Voice output

Voice output converts approved text/SSML-like content into a provider-neutral output request. A separate injected renderer performs synthesis/playback. The core never owns the audio device.

## Documents and screenshots

Documents are normalized to semantic text/metadata. Screenshots/camera frames are normalized to visual observations and optional semantic UI state. A screenshot-to-action flow remains delegated to the existing Computer Use planner/executor boundary.

## Compatibility

Multimodal + Voice v1 is additive. It does not modify router, fallback, execution engine, Computer Use, Multi-Agent 2.0, Self-Model, World Model, or credential contracts.
