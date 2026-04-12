# conflux-workspace

CLI for launching and managing the CFX DevKit workspace container.

## Usage

Run without installing:

```bash
npx conflux-workspace start
```

Create a project from the built-in scaffold:

```bash
npx conflux-workspace create ./my-project
```

Launch an existing project folder:

```bash
npx conflux-workspace start ./my-project
```

Inspect or stop a workspace:

```bash
npx conflux-workspace status
npx conflux-workspace stop ./my-project
```

## Image resolution

The CLI selects the workspace image in this order:

1. `--image`
2. `--local-image`
3. Local image `cfxdevkit/devkit-workspace-web:latest` when present
4. Published image `ghcr.io/cfxdevkit/devkit-workspace-web:<version>`

## Requirements

- Node.js 22+
- Docker or Podman

For full project documentation, see the repository root README.