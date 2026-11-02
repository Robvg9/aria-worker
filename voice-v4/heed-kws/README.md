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

