# Heed Spanish KWS feasibility work

This is an isolated model-training experiment. It does not connect to ARIA runtime, the PWA, Android, Windows, the command router, or the mission queue.

- Runtime/trainer: \`heed-wakeword==0.1.4\`, Apache-2.0.
- The hosted workflow uses eSpeak NG Spanish voice variants to train two tiny candidates: \`Aria\` and \`Oye Aria\`.
- It keeps some voice profiles out of training and evaluates them only after training, using confusable phrases including \`Malaria\`, \`María\`, \`área\`, \`Oye María\`, \`Oye Malaria\`, and \`Oye Área\`.
- The workflow retains only aggregate metrics and exported model sizes when a candidate passes. Synthetic audio is generated in an ephemeral GitHub runner and deleted at the end.

**Limits:** eSpeak voice variants are not true independent speakers and not Cuban human voices. A synthetic pass is only a shortlist signal; it is not owner enrollment, biometric authentication, a measured real-world false-activation rate, or permission to enable an always-on listener. No real owner audio is collected. No user PC or phone is touched.
