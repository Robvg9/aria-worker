# ARIA unified Android package transition

The unified ARIA Android application uses package com.robvg9.aria.unified.

The Android UI Agent's native classes remain in the com.robvg9.ariauiagent namespace, but Android components are installed inside the unified application package. Termux therefore targets:

- Application package: com.robvg9.aria.unified
- Accessibility module receiver class: com.robvg9.ariauiagent.CommandReceiver
- Local Mission activity class: com.robvg9.ariauiagent.MainActivity
- IPC: 127.0.0.1:45874, protocol aria-android-ui-agent-ipc-v2

The loopback health endpoint returns the host application package. Termux requires an exact match to the unified application before it reports the HTTP service healthy. Action responses also carry service_package; an old application that still owns the shared port cannot be mistaken for the new host. A package mismatch falls back to the explicitly qualified receiver in the unified application.

## Owner cutover

Keep the existing com.robvg9.aria APK installed as rollback. The unified app is intentionally installed side-by-side as com.robvg9.aria.unified because this is a separate package ID for parallel QA/rollback, not an in-place update of the old package. The current ARIA Unificada 0.1.2 artifact was verified with Android's V2 signature scheme but its signer is CN=Android Debug (certificate SHA-256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c). It is QA-only, not a production-signed release. The production keystore and approved ANDROID_SIGNING_CERT_SHA256 were absent from the verified CI run; do not claim production signing until those are configured and the emitted certificate digest matches the approved digest. Before the new Local Mission service is certified, the owner must ensure that only the unified ARIA Accessibility Service is enabled. Android can have more than one Accessibility Service enabled at once; do not treat the old service's state as proof that the unified one is running.

Do not uninstall the legacy APK until the unified app passes physical observe → propose → explicit approve → action → post-observe → evidence and the Termux heartbeat reports the unified package and exact build ID.
