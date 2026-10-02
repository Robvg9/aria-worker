# Contributing to ARIA Worker

## Canonical multi-device workflow

ARIA is developed from multiple execution environments. The repository uses **PR-first integration**.

```
Developer/executor → dedicated branch → commit → push → Pull Request → CI → review/evidence → merge → main → LIVE verification
```

### Protected main

`main` is the integration and certification branch.

Never use:

```
git push origin main
```

for normal development.

Every product change must arrive through a pull request. Do not force-push `main`.

### Development lanes

Use a unique branch per active workstream.

Recommended examples:

- `pc-lacueva/<scope>`
- `pc-otra/<scope>`
- `feat/<scope>`
- `fix/<scope>`
- `chore/<scope>`
- `aria/<scope>`
- `ops/<scope>`

Do not have two machines sharing the same writable branch at the same time.

### Android is a first-class execution lane

Android is normally an **execution/verification device**, not a separate Git checkout.

Android work must therefore be tracked through the same PR/change lineage, while its runtime evidence is attached to the mission, job, test, or PR.

For changes that specifically modify Android source, an `android/<scope>` branch and PR are required.

A successful Android E2E is evidence for the exact deployed commit/version tested. It does not replace CI or the merge step.

### Merge gate

A change is not considered integrated merely because code exists on a branch.

Before merging into `main`, record:

1. CI/test result.
2. Relevant regression result.
3. Runtime/deployment impact.
4. Device E2E evidence when the change crosses a device boundary.
5. Persisted result and exact commit/version.

For cross-platform changes, certify the affected lanes separately (PC and/or Android).

### Conflict prevention

Before starting work on a branch:

```bash
git fetch origin
git switch <your-branch>
git rebase origin/main
```

Before opening or updating a PR:

```bash
git fetch origin
git diff --check
git status
```

If `main` moved while you were working, update your branch from `origin/main` before merge rather than pushing directly to `main`.

### Definition of done

ARIA changes follow the repository rule:

```
main code → tests PASS → deploy LIVE → real E2E → persisted state → no contradictions
```

A failed E2E remains a finding until the failure is either corrected and re-tested or explicitly documented as a blocked route.

**Rule:** PCs develop. Android executes/verifies. `main` certifies.
