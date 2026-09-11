# BC-4 — Sandboxed Modification Contract

## Purpose
Provide a governed boundary for ARIA to modify BattleCruiser without writing to `main`.

## Required lifecycle

`inspect → plan → branch_sandbox → modify → regression → evaluate`

## Invariants

- Repository target defaults to `Robvg9/battlecruiser`.
- `main` is never writable by this controller.
- Modification branches must start with `aria/sandbox/`.
- `inspect` and `plan` are read-only.
- `branch_sandbox` permits only `branch_create`.
- `modify` permits only `file_write` on the sandbox branch.
- `regression` permits `test_execute` on the sandbox branch.
- `evaluate` permits `evaluate_change` on the sandbox branch.
- Absolute file paths and `..` traversal are rejected.
- The controller selects no provider, model, account, credential, or fallback route.
- Credentials are supplied by the existing connector/runtime boundary, never embedded in a sandbox plan.

## Scope

BC-4 defines the safety contract and orchestration boundary. It does not yet grant arbitrary production write authority and does not merge changes automatically.
