# V4 speaker verification candidate

Candidate: sherpa-onnx + 3D-Speaker CAM++ speaker embedding model.

- Model: \`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx\` (~28.3 MB).
- Runtime: sherpa-onnx supports Android, Windows, x86/x64/ARM and offline speaker embedding/verification. Runtime code is Apache-2.0; model license must be checked separately.
- Model upstream: 3D-Speaker; repository states Apache-2.0. The model card says Chinese/English training, not Cuban Spanish.
- The speaker model runs only after a valid wake event and on a captured utterance; it is not part of continuous always-on inference.
- Test workflow uses public sherpa release demonstration WAVs to compare a small same-speaker enrollment group against different-speaker clips. It reports aggregate similarity and timing only. It does not upload or store waveforms in artifacts.
- This is only an API/model feasibility smoke, not biometric authentication acceptance. It does not prove speaker accuracy for Spanish/Cuban accents, replay resistance, synthetic speech detection or owner identity.
- Production enrollment must be voluntary, local, encrypted using Android Keystore / Windows DPAPI, erasable by the owner, and calibrated with owner and non-owner samples on all target devices. Biometrics are not the sole approval factor for messages, payments, deletion or security changes.

Sources:
- [sherpa-onnx speaker identification models](https://k2-fsa.github.io/sherpa/onnx/speaker-identification/)
- [speaker model release and model assets](https://github.com/k2-fsa/sherpa-onnx/releases/tag/speaker-recongition-models)
- [3D-Speaker project and Apache-2.0 license](https://github.com/modelscope/3D-Speaker)

## CI feasibility checkpoint

The repository now includes a hosted-only public-sample smoke workflow at `.github/workflows/aria-voice-v4-speaker-benchmark.yml`. It will compare a small public same-speaker group against different-speaker examples and retain aggregate metrics only. This is an API/model feasibility check; the selected CAM++ model card covers Chinese/English rather than Cuban Spanish, and a passing ranking smoke cannot authorize owner authentication or background listening.

## Hosted feasibility run — 2026-11-02

Run the public-sample CAM++ smoke on an ephemeral GitHub-hosted Linux runner. This checks that the pinned ONNX runtime can load the selected model and rank a tiny same-speaker set above a different-speaker set. It uses no owner audio, records no waveform, and retains only aggregate cosine scores and runtime/memory metadata.

A pass is only a model/runtime sanity check. The selected release model is trained for Chinese/English, so it is not eligible for owner verification on Cuban Spanish without a separate multilingual and real-world evaluation. No model is approved for production by this run.

