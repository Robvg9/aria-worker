# ARIA Voice V4 — candidate feasibility checks

This directory is isolated research tooling. It is not imported by the PWA, Android agent, Windows agent, or production runtime.

## Vosk Spanish KWS smoke

```bash
python voice-v4/benchmark/vosk_spanish_keyword.py \
  --model ./vosk-model-small-es-0.42 \
  --report ./aria-vosk-es-report.json
```

The GitHub-hosted workflow downloads the official Spanish small Vosk model, synthesizes short Spanish phrases with eSpeak NG, and tests a constrained `aria` grammar against several confusable phrases. The report contains only boolean outcomes and timings; it does not contain audio or transcribed text.

This benchmark is deliberately a smoke test, not a release gate for physical voice recognition. Synthetic pronunciation is not Robert's Cuban Spanish, and GitHub-hosted CPU/RAM does not represent RobVG, LaCueva, or Android. No user devices are touched.


## Model research checkpoint — 2026-11-02

### Vosk Spanish small model — rejected

Two hosted synthetic-speech experiments were run with `vosk-model-small-es-0.42` (39 MB):
- Standalone `aria` grammar: false activations on `María` and `área`; one positive `Oye Aria` utterance was missed. Process peak RSS was 146.69 MB; model load 252.35 ms.
- Exact two-token `oye aria` grammar: no false activations in this tiny corpus, but both positive `Oye Aria` utterances were missed. Process peak RSS was 144.80 MB; model load 149.40 ms.
- Conclusion: candidate rejected. Do not integrate or install. These are synthetic eSpeak tests only, not a real-world false-accept measurement.

The larger Vosk Spanish model is listed at 1.4 GB and is intended for server-class use; it is not a sensible always-on candidate for the owner's constrained desktop/mobile resources.

### Alternative engine — onnx-wakeword / Voicute

Repository: https://github.com/voicute/onnx-wakeword (pinned research revision `8002ba9a14d80c0f71447920d3f1c8ee986b1432`).

- Runtime code declares MIT licensing and provides ONNX/TFLite inference examples for Android, Web, and Python/Windows.
- The project includes a Spanish `Hola Orion` demo package; this is not the ARIA keyword and must not be mistaken for an ARIA-ready model.
- Its web runtime downloads only the configured model assets and processes mic frames locally in the inspected path; Python and Android inference examples process audio locally.
- The repository's Android sample uses `AudioRecord` and asks for `RECORD_AUDIO`, but its sample manifest does not provide a microphone foreground service. We must implement ARIA's own Android foreground/assistant service and comply with Android's background-microphone rules; the sample alone does not prove always-on operation.
- Vendor pages say text-only basic training and browser evaluation are free, while downloading a custom model is paid. A vendor article currently publishes US$14.99 for a basic model and US$49 for voice enhancement; those prices and performance claims are self-published and must be confirmed before any purchase. No account, purchase, or real voice upload was made.
- No model from this project has been embedded in ARIA or deployed. It remains the leading KWS-runtime candidate, conditional on licensing, exact ARIA model test, privacy review, and Cuban Spanish false-trigger testing.

### Remaining mandatory controls

A wake-word score is not speaker identity. Implement local speaker enrollment/verification as a separate layer, keep replay/deepfake limitations explicit, and require confirmation for sending messages or other high-impact actions. Keep READ, user-approved DEVICE ACTION, and AUTONOMOUS MISSION EXECUTION as separate routes. The mission execution freeze remains unchanged.


### Comparison: openWakeWord paths

- The upstream `dscripka/openWakeWord` repository states that its shipped wake models are English-only. Its documented custom pipeline recommends several thousand positive samples and very large negative corpora (the included models were trained with roughly 30,000 hours of speech/noise/music). That is not a dependable zero-cost Spanish ARIA shortcut.
- A separate site at `openwakeword.com` advertises multilingual custom training; it is not the same thing as the upstream English-only repository. Its public Spanish `Hey Alfred` example reports 32.8% recall and 62.23 false activations/hour on its published benchmark. That result is not suitable for an always-listening owner assistant.
- Neither route is accepted as ARIA's production wake detector at this checkpoint.


## Direct command lane checkpoint — 2026-11-02

An isolated policy module now exists at `voice-v4/command-router.js`, with root test `tests/voice-v4-command-router.test.js` and specification `voice-v4/COMMAND-LANES.md`.

The module separates:
- `read`: only `aria.status` and `device.status`, no mutating execution.
- `device.action`: initial allowlist only: brightness 0–100, pre-approved app ID, or HTTPS URL on a pre-approved host. Requires a fresh owner session, a trusted speaker-verification result from an injected native verifier, capability authorization, trusted/healthy explicitly targeted device, a short expiry and shared atomic idempotency key.
- `mission.execute`: hard blocked while mission freeze is active; outside freeze it still only returns a human-confirmation-required state.

`message.send` returns a recipient/body preview that requires confirmation in a visible authenticated UI. It never calls an executor. Raw shell, PowerShell, arbitrary code, mission IDs/jobs on the direct action lane and implicit target selection are rejected.

This is a pure policy contract, not a connected runtime. No API, Supabase, Android service, Windows agent, or device adapter invokes it yet. The injected owner-session verifier must verify a cryptographically signed local assertion; a caller-provided boolean is not sufficient. The idempotency adapter must be atomic/shared across Android and Windows. Speaker verification must be calibrated against replay and non-owner voices. The module never calls the mission dispatcher or creates jobs.

## Speaker verification candidate

A separate hosted-only smoke test evaluates the public sherpa-onnx / 3D-Speaker CAM++ model (about 28.3 MB). The workflow uses public sample clips only; it reports aggregate embeddings similarity, model load/latency and peak memory. It never downloads, records or uploads Robert's voice. The model card covers Chinese/English, so its transfer to Cuban Spanish is not assumed. Model and runtime license review is documented in `voice-v4/speaker-verification/README.md`.

The candidate test is preliminary and must not be treated as identity authentication acceptance. A production enrollment would need owner-consented samples, local encrypted storage via Android Keystore / Windows DPAPI, owner-controlled erase/reset, per-device threshold calibration, replay/deepfake defenses and separate human confirmation for high-impact actions.
