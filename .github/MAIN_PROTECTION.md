# Main branch protection — canonical setting

Repository policy:

- No direct development pushes to `main`.
- Pull request required for changes to `main`.
- Force pushes to `main` disabled.
- Deleting `main` disabled.
- Required status check: **Multi-device Git guard / Branch and integration policy**.
- Require branch to be up to date before merge when supported by repository settings.
- CODEOWNERS review applies to repository changes.
- Merge only after required CI + relevant E2E evidence is available.

## Device lanes

| Lane | Git role | Runtime role |
|---|---|---|
| PC LaCueva | dedicated branch | Windows execution/E2E |
| PC Otra | dedicated branch | PC execution/E2E |
| Android | normally no Git checkout | Android execution/RWHT/E2E |
| main | integration only | certification/deployment source |

The Android row is intentional: Android must participate in verification without becoming a second uncontrolled source branch.

## Operational rule

`main` is never the workspace of an active task. A device may read/update its own branch; merging into `main` is an explicit integration event.

If a device loses connectivity, do not create a replacement branch from an unknown local state. Recover from GitHub and continue from the last known commit/PR.
