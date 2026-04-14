# ui-shared Materialization Contract

## Purpose

Keep `packages/ui-shared` as the canonical authored package while ensuring generated projects are self-contained.

## Contract

Generated projects receive a materialized copy of `packages/ui-shared` at scaffold generation time.

The generated project must not depend on the source monorepo after creation.

## Copy rules

### Copy source

Copy from:

- `packages/ui-shared/**`

Into generated project path:

- `<generated-project>/ui-shared/**`

### Exclude

Do not copy:

- `node_modules`
- build output directories
- cache directories
- local editor artifacts
- repo-specific lockfiles if the generated project owns its own lockfile lifecycle

### Preserve

Preserve:

- package metadata required by the generated project
- source files
- tsconfig and Tailwind config when the scaffold uses them
- any template-owned overrides declared explicitly in a manifest

## Required verification

Every materialization operation must be verifiable.

### Verification checks

1. source exists and contains package manifest
2. destination is written successfully
3. copied package manifest matches the canonical package version
4. excluded paths are absent in destination
5. optional hash manifest can be emitted for future diffing

## Override policy

Template-specific overrides are allowed only through explicit manifests.

Example shape:

```json
{
  "copy": ["src", "package.json", "tsconfig.json"],
  "exclude": ["node_modules", "dist"],
  "overrides": []
}
```

No implicit post-copy mutations are allowed.

## Future extension

The same mechanism can later materialize other canonical packages into generated projects, but `ui-shared` is the first supported case.
