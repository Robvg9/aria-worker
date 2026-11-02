# Spanish KWS candidate — sherpa-onnx Zipformer

Candidate model: \`jguerrisi/sherpa-onnx-kws-zipformer-es-3M-2026-08-08\`, pinned to revision \`d4fa6bd\`.

- Model card advertises Apache-2.0, streaming open-vocabulary Spanish KWS, runtime-configurable keyword list via SentencePiece BPE, and a 3.3M-parameter Zipformer transducer.
- Published assets total about 19.5 MB; the FP32 encoder is about 12.5 MB, decoder 1.06 MB, joiner 642 KB, plus tokens/BPE. INT8 assets are also available but the model card says Spanish INT8 has not been evaluated yet.
- The author reports 100% recall over five safety keywords and 0 false positives on a single 536.7-second recording. This is a small author-reported evaluation, not an independent or broad real-world benchmark.
- Training data is 300 hours of Multilingual LibriSpeech Spanish plus Piper-TTS keyword synthesis. The author explicitly warns that strongly accented and noisy speech may differ and asks target-population testing.
- Keyword BPE encoding can add phrases such as \`aria\` and \`oye aria\` without retraining the model. This is a promising candidate, not yet validated for the ARIA wake phrase.
- A hosted GitHub Actions smoke tests the configured phrases against eSpeak Spanish positives and confusables (\`Malaria\`, \`María\`, \`área\`, etc.), with no microphone or owner audio. Only aggregate metadata is retained.
- If it passes, it is a shortlist for later real voice enrollment/certification; it is not permission to activate a background listener or ship production.
- Android/Windows runtime integration must still meet each platform's resident-microphone, battery, permission, and stop-control requirements.

Source/model card: https://huggingface.co/jguerrisi/sherpa-onnx-kws-zipformer-es-3M-2026-08-08
Official sherpa keyword spotting docs: https://k2-fsa.github.io/sherpa/onnx/kws/index.html
