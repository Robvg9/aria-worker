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
