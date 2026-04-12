# @cfxdevkit/devkit-backend

Vendored backend-only copy of `conflux-devkit` used for fast iteration inside this workspace.

Purpose:
- Refine backend behavior locally without waiting on upstream release cadence.
- Keep changes easy to backport into upstream `devtools/devkit`.

This package intentionally includes only the backend runtime (`src/cli.ts`, `src/server/**`) and no UI assets.
