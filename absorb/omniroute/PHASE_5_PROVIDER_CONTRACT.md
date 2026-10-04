# OmniRoute Phase 5 — Real Provider: Ollama → Qwen

Status: PREPARED / NOT CERTIFIED

## Purpose
Prove the real provider path on the authorized Windows machine:
exact OmniRoute 3.8.52 → self-hosted OpenAI-compatible provider → native Ollama → qwen3:4b.

## Required checks
1. Ollama reachable at 127.0.0.1:11434.
2. qwen3:4b present in the local Ollama model store.
3. Direct Ollama inference returns OMNIROUTE_QWEN_LIVE_OK.
4. Exact OmniRoute commit 3e66ff2e8cc94821b093fe57dad667b585230cd1 installs and builds.
5. OmniRoute runs isolated on loopback port 20130 with a dedicated DATA_DIR.
6. Provider id ollama targets http://127.0.0.1:11434/v1.
7. Authenticated /v1/chat/completions with model ollama/qwen3:4b returns HTTP 200.
8. Response is non-empty and contains OMNIROUTE_QWEN_LIVE_OK.
9. Response metadata identifies provider ollama.
10. ARIA canonical mission/runtime state is untouched.

## Fail-closed
Missing Ollama, missing qwen3:4b, wrong source SHA, occupied port, build failure, or missing provider attribution => NOT CERTIFIED.
No ARIA provider credentials are copied into the standalone environment.
No ARIA runtime capability is enabled by this phase.

## Gate
Phase 5 becomes PASS only after the real provider receipt exists from the Windows runner.