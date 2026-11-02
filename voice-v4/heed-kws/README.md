# Heed Spanish KWS feasibility work

This is an isolated model-training experiment. It does not connect to ARIA runtime, the PWA, Android, Windows, the command router, or the mission queue.

- Runtime/trainer: \`heed-wakeword==0.1.4\`, Apache-2.0.
- The hosted workflow uses eSpeak NG Spanish voice variants to train two tiny candidates: \`Aria\` and \`Oye Aria\`.
- It keeps some voice profiles out of training and evaluates them only after training, using confusable phrases including \`Malaria\`, \`María\`, \`área\`, \`Oye María\`, \`Oye Malaria\`, and \`Oye Área\`.
- The workflow retains only aggregate metrics and exported model sizes when a candidate passes. Synthetic audio is generated in an ephemeral GitHub runner and deleted at the end.

**Limits:** eSpeak voice variants are not true independent speakers and not Cuban human voices. A synthetic pass is only a shortlist signal; it is not owner enrollment, biometric authentication, a measured real-world false-activation rate, or permission to enable an always-on listener. No real owner audio is collected. No user PC or phone is touched.

## Alternative model-selection checkpoint — 2026-11-02

The open-vocabulary sherpa-onnx Spanish candidate was evaluated twice in a hosted, synthetic-only smoke after correcting the score/threshold sweep wiring.

- Result: \`no_candidate_passed_synthetic_gate\`.
- \`aria\`: 0/12 positive detections at the best tested configuration; 0/30 negative false triggers; controls 6/6.
- \`oye aria\`: 0/6 positive detections; 0/36 negative false triggers; controls 6/6.
- The benchmark therefore does not shortlist this pretrained model for ARIA. A successful runtime/benchmark job is not evidence that the wake phrase works.
- The follow-up is a purpose-trained Heed candidate with held-out synthetic voice profiles and an expanded confusable corpus. It remains a shortlist experiment only; it cannot authorize production/background capture or owner authentication.

## Heed synthetic shortlist result — 2026-11-02

Run [#41532084557](https://github.com/Robvg9/aria-worker/actions/runs/41532084557) completed SUCCESS as a benchmark and produced:

- aria: REJECTED — 54 held-out positives, TPR 94.444%, 450 hard-negative clips, FPR 0%; the recall gate was 95%.
- oye_aria: SYNTHETIC SHORTLIST — 36/36 held-out positives detected (TPR 100%) and 0/522 false triggers on the synthetic hard-negative set (FPR 0%).
- INT8 ONNX model: 41,021 bytes (41 KB), threshold 0.72; session load 5.969 ms; mean inference 0.301 ms; p95 0.317 ms; 1 inference thread.
- The training process used about 1.82 GB peak RSS on the hosted runner. The previous runtime RSS field mirrored that figure and is not considered a trustworthy isolated-inference memory result. The benchmark has been changed to report the ONNX process /proc/self/status current RSS and high-water RSS separately; those values need a fresh run before assessing device resource fit.
- Training and ONNX scores are entirely eSpeak-generated. Held-out voices es-la and es-mx are only TTS configurations, not independent human speakers. The zero-FP result does NOT estimate a real-world false activation rate.

The historical run above retained only its aggregate report; it did not retain an ONNX/sidecar pair. The current branch has since added package generation, but that code still needs an exact-HEAD run.
The next hosted workflow now validates the `.onnx` + `wake.json` pair, SHA-256 for both files, matching phrase and threshold, exact preprocessing order, 16 kHz/40-mel contract, and the explicit `release_approved=false` flag before artifact upload. It rejects unreferenced files and any audio/WAV output.
Even a complete package gate remains a synthetic research result only: no production app imports it, no devices are touched, and Oye ARIA is not approved for live listening.

