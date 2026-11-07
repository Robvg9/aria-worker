# ARIA unified Android package transition

The unified ARIA Android application uses package com.robvg9.aria.unified.

The Android UI Agent's native classes remain in the com.robvg9.ariauiagent namespace, but Android components are installed inside the unified application package. Termux therefore targets:

- Application package: com.robvg9.aria.unified
- Accessibility module receiver class: com.robvg9.ariauiagent.CommandReceiver
- Local Mission activity class: com.robvg9.ariauiagent.MainActivity
- IPC: 127.0.0.1:45874, protocol aria-android-ui-agent-ipc-v2

The loopback health endpoint returns the host application package. Termux requires an exact match to the unified application before it reports the HTTP service healthy. Action responses also carry service_package; an old application that still owns the shared port cannot be mistaken for the new host. A package mismatch falls back to the explicitly qualified receiver in the unified application.

## Owner cutover

Keep the existing com.robvg9.aria APK installed as rollback. The unified app is intentionally installed side-by-side as com.robvg9.aria.unified because the existing QA APK is Android Debug-signed while the new release APK uses the configured production certificate; Android will not update an installed package across signing certificates. Before the new Local Mission service is certified, the owner must ensure that only the unified ARIA Accessibility Service is enabled. Android can have more than one Accessibility Service enabled at once; do not treat the old service's state as proof that the unified one is running.

Do not uninstall the legacy APK until the unified app passes physical observe → propose → explicit approve → action → post-observe → evidence and the Termux heartbeat reports the unified package and exact build ID.
