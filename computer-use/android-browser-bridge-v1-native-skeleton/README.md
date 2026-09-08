# ARIA Android Browser Bridge v1 — Native Skeleton

This directory is a design/build skeleton for the future Android-native bridge. It is intentionally not treated as production-certified until it is compiled into the ARIA Android development build and passes the physical Human Gate.

The service uses Android `AccessibilityService` and must only interact with explicitly configured browser packages. It exposes observation/action semantics compatible with `computer-use/runtime-v1`.

See `android-browser-bridge-v1-contract.md` for invariants and the Human Gate.
