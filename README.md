# CFX DevKit Web

A self-contained browser-based IDE for Conflux blockchain development.

One container gives you: **code-server** (VS Code in the browser) + **Conflux node** + **MCP server** for AI-assisted development + the **CFX DevKit VS Code extension** pre-installed.

Open `http://localhost:8080` — no local VS Code or Node.js installation required.

The main workspace runs on host networking. The built-in services are reachable directly on their host ports and through code-server proxy paths such as `/proxy/3030/`, `/proxy/7748/`, and `/proxy/8888/`.

---

## Architecture

The image is built in 7 stages:

| Stage | What it adds |
|-------|-------------|
| `fetch-code-server` | Downloads the pinned `code-server` package independently so ordinary source changes do not force a fresh binary download |
| `fetch-opencode` | Downloads the pinned `opencode` archive independently so ordinary source changes do not force a fresh binary download |
| `builder` | Compiles all TypeScript packages; packs `@cfxdevkit/mcp` and the `.vsix` extension |
| `base` | Debian slim + system tools + GitHub CLI + Docker CLI + code-server |
| `devkit` | Vendored workspace backend runtime + `devkit-mcp` global binary |
| `opencode` | `opencode` CLI + baked-in AI skills and config |
| `runtime` | VS Code extension installed + assembled built-in project workspace + entrypoint |

The 500 MB+ `node_modules` build tree never reaches the final image.

Source-of-truth layout for the built-in example:
- `scaffolds/project-example/` is the canonical authored scaffold source, including `ui-shared/`.
- `.generated/project-example/` is the local assembled workspace generated from the canonical scaffold.
- `packages/workspace-cli/dist/template/project-example/` is the packaged CLI template artifact generated from the canonical scaffold.
- `packages/ui-shared/` remains the workspace package used by app surfaces outside the scaffold template.

Scaffold normalization guardrails:
- `pnpm run scaffold:verify` validates both direct scaffold build and assembled build parity.
- CI runs this parity check on pushes/PRs touching scaffold/package/workflow paths.

Build-cache approach:
- version-pinned external binaries are isolated into dedicated fetch stages
- `apt`, `npm`, and `pnpm` use BuildKit cache mounts
- `pnpm image:build` enables Docker BuildKit automatically through the compose wrapper

Why this was chosen:
- slow-network rebuilds were dominated by repeated downloads rather than compilation
- fetch stages make cache reuse stable until the pinned version changes
- the normal developer entrypoint stays the same, so nobody has to remember extra Docker flags

Network model in this workspace:
- the vendored workspace backend manages the local lifecycle stack (keystore/node/mining/contracts).
- Testnet/mainnet operations are performed through RPC-driven tooling (`@cfxdevkit/core` clients and public deploy scripts), not by local node lifecycle endpoints.

### Packages (`packages/`)

| Package | Description |
|---------|-------------|
| `@cfxdevkit/shared` | Typed HTTP client and shared types used by both the extension and MCP server |
| `@cfxdevkit/mcp` | MCP server (`devkit-mcp` binary) — exposes Conflux devkit tools to AI agents |
| `cfxdevkit-workspace-ext` | VS Code extension — sidebar panels, node control, contract deployment |
| `conflux-workspace` | CLI helper (`conflux-workspace` binary) used inside the container |

---

## Prerequisites

- **Docker** or **Podman** (rootless or rootful)
- Host networking available for the container runtime
- Ports `8080`, `3030`, `7748`, `8545`, `8546`, `8888`, `12537`, `12535` available on the host

---

## Current Setup Flow

This is the intended end-to-end setup sequence for the current launcher model.

### 1. Choose how you want to invoke the CLI

Use one of these entrypoints:

- `npx conflux-workspace ...` for published package usage
- `conflux-workspace ...` after installing the CLI locally from this repo
- `pnpm run workspace:*` when working from this repo and using the local image workflow

### 2. If you are working from this repo, install the CLI and build the local image

```bash
pnpm run workspace:install
export PATH="$HOME/.local/bin:$PATH"
pnpm run workspace:build
```

Why install first and build after:

- `workspace:install` installs the `conflux-workspace` command into `~/.local/bin`
- `workspace:install` already builds the CLI package itself as part of installation
- `workspace:build` is a different step: it builds the container image used by `start`

So the sequence is not “build the same thing twice”. It is:

- build and install the command-line tool
- then build the workspace container image that the tool will run locally

At that point:

- `conflux-workspace ...` is available directly in your shell
- the local image is available for launches from this checkout
- `doctor` can confirm the runtime, socket, local image, and state file

If both Podman and Docker are installed, the repo-level image helpers normally
auto-detect a runtime and prefer Podman. To force a specific runtime for local
image builds from this repo, set `CFXDEVKIT_RUNTIME`:

```bash
CFXDEVKIT_RUNTIME=docker pnpm image:build
CFXDEVKIT_RUNTIME=podman pnpm image:build
```

Use the same runtime when launching with `conflux-workspace start --runtime ...`
so the launcher can see the local image in that runtime's image store.

### 3. Create or choose a workspace target

You have two normal paths:

```bash
# Create a fresh project from the built-in example
conflux-workspace create ./my-project

# Or use an existing folder directly
conflux-workspace start /path/to/existing/project
```

### 4. Start the workspace

```bash
# Built-in example
conflux-workspace start

# Custom project folder
conflux-workspace start ./my-project
```

The launcher starts one managed workspace container at a time and persists user
state in a profile-specific volume.

### 5. Manage the workspace lifecycle

```bash
conflux-workspace status
conflux-workspace list
conflux-workspace stop ./my-project
conflux-workspace rm ./my-project
conflux-workspace purge ./my-project
```

### 6. Use aliases or profile slugs when you no longer want to type paths

```bash
conflux-workspace alias set demo ./my-project
conflux-workspace start --alias demo
conflux-workspace purge --profile ws-123456789abc
```

---

## Current Patterns

The current setup is built around a few operational patterns.

### Pattern 1: Path-first targeting

Paths are the primary identity for custom workspaces.

- starting the same path again reuses the same deterministic profile
- switching to another path switches to another profile
- the built-in example is the special default profile when no path is given

### Pattern 2: One profile, one persisted home volume

Each workspace profile gets its own persisted `/home/node` volume.

- code-server state is isolated per workspace
- keystore and chain data are isolated per workspace
- switching workspaces does not reuse one global state volume

### Pattern 3: One active managed container at a time

The launcher is optimized for a single active workspace session.

- starting a workspace stops and removes other managed workspace containers
- profile state is preserved in volumes unless you explicitly `purge`

### Pattern 4: Local-first repo workflow

When working from this repository:

- `pnpm run workspace:*` always targets the local image workflow
- direct `conflux-workspace` usage now also prefers the local image automatically when it exists
- this keeps local development and installed CLI usage aligned

### Pattern 5: Published fallback

When no local image exists and no explicit image is provided:

- direct CLI usage falls back to the published image
- this supports `npx conflux-workspace ...` usage outside a repo checkout

### Pattern 6: Discovery without mandatory indirection

The launcher keeps path-based commands as the canonical interface, but adds
optional discovery helpers.

- `list` shows known profiles, aliases, and persisted state shape
- `status` shows the detailed runtime view
- `alias` gives you short names when paths are too long
- `--profile` lets you operate on a profile slug directly when appropriate

---

## Quickstart

### Run the CLI

All command examples in this document use the same CLI syntax:

```bash
conflux-workspace <command> [options] [target]
```

You can invoke that CLI in three equivalent ways:

```bash
# Published wrapper
npx conflux-workspace <command> [options] [target]

# Direct system command after local install from this repo
conflux-workspace <command> [options] [target]

# Root helper scripts for local image workflows
pnpm run workspace:<command> -- [options] [target]
```

Use the `npx` form when you want the published package. Use the direct
`conflux-workspace` command after installing it locally from this checkout.
Use the `pnpm run workspace:*` scripts when you want the same CLI behavior but
defaulted to the local image and local build context.

Direct `conflux-workspace` launches now select the image in this order:

- explicit `--image`
- explicit `--local-image`
- local image `cfxdevkit/devkit-workspace-web:latest` when it already exists
- published image `ghcr.io/cfxdevkit/devkit-workspace-web:<version>`

That keeps locally installed usage aligned with repo-based workflows while still
allowing published `npx` usage to fall back to the published image when no
local image exists.

By default, both the direct CLI and the local wrapper scripts show concise
results only. Add `--verbose` when you want the underlying build or runtime
command output.

### Install the CLI locally from this repo

```bash
# Build and install the CLI into your user-local prefix
pnpm run workspace:install

# Remove the user-local installation later if needed
pnpm run workspace:uninstall

# Check local runtime, socket, and launcher state
pnpm run workspace:doctor

# Create a new project folder from the built-in example
pnpm run workspace:create -- ./my-project
```

The install script uses a user-owned npm prefix under `~/.local`, so it does
not require `sudo` even when your default npm global prefix points to `/usr`.

The install flow also runs environment validation before installing the command.
If Docker or Podman is missing or inaccessible, installation stops with a clear
error so the system problem is fixed before first use.

After `pnpm run workspace:install`, make sure this directory is on your `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
```

If you want that permanently, add the same line to your shell profile such as
`~/.bashrc`, `~/.zshrc`, or `~/.config/fish/config.fish`.

Do not use `sudo pnpm run workspace:install`. `sudo` usually drops your user
tooling from `PATH`, which is why `pnpm` was not found in your earlier attempt.

### Common examples

```bash
# Run the published image
npx conflux-workspace start

# Run the built-in project-example again later
npx conflux-workspace start

# Start with your own project folder
npx conflux-workspace start /path/to/your/project

# Stop a specific workspace profile
npx conflux-workspace stop /path/to/your/project

# Remove a workspace container but keep its persisted state
npx conflux-workspace rm /path/to/your/project

# Remove a workspace profile entirely
npx conflux-workspace purge /path/to/your/project

# Remove a profile directly from its slug shown in list/status
npx conflux-workspace purge --profile ws-123456789abc

# Show managed profiles
npx conflux-workspace status

# List known profiles with aliases
npx conflux-workspace list

# Save a reusable alias for a custom path
npx conflux-workspace alias set demo /path/to/your/project

# Target the alias later
npx conflux-workspace start --alias demo

# Inspect one specific profile by slug
npx conflux-workspace status --profile ws-123456789abc

# Show runtime, socket, and state diagnostics
npx conflux-workspace doctor

# Create a new project from the built-in example template
npx conflux-workspace create ./my-project

# Show full underlying build/runtime output when needed
npx conflux-workspace start --verbose
```

### Using local package scripts

The root `pnpm run workspace` scripts use the same CLI implementation as the
published wrapper, but default to the local image and local Docker build
context.

For image iteration specifically, prefer `pnpm image:build`. That path now
forces Docker BuildKit automatically when Docker is the active runtime, which
is required for the Dockerfile cache mounts and isolated fetch stages to help.

```bash
# Build the local image with the cache-aware Docker path
pnpm image:build

# Build the local image from this repo checkout
pnpm run workspace:build

# Start the built-in project-example from the local image
pnpm run workspace:start

# Start a custom project from the local image
pnpm run workspace:start -- /path/to/your/project

# List known profiles and aliases
pnpm run workspace:list

# Remove a profile directly from its slug
pnpm run workspace:purge -- --profile ws-123456789abc

# Save or inspect aliases locally
pnpm run workspace:alias -- set demo /path/to/your/project
pnpm run workspace:alias

# Inspect a specific profile slug locally
pnpm run workspace:status -- --profile ws-123456789abc

# Run local diagnostics
pnpm run workspace:doctor

# Create a new project from the built-in example template
pnpm run workspace:create -- ./my-project

# Enable full underlying output only when needed
pnpm run workspace:start -- --verbose

# Rebuild local image and restart a workspace profile
pnpm run workspace:rebuild -- /path/to/your/project
```

### Command reference

The command semantics are the same whether you use `npx conflux-workspace`, a
direct `conflux-workspace` install, or the root `pnpm run workspace:*` wrapper.

| Command | What it does | Data preserved |
|---------|---------------|----------------|
| `start` | Starts the selected workspace profile and stops any other managed running profile first | Yes |
| `stop` | Stops the selected profile container only | Yes |
| `rm` | Removes the selected profile container only | Yes |
| `purge` | Removes the selected profile container and its home volume | No |
| `status` | Shows detailed runtime information for one profile or all known profiles | N/A |
| `list` | Shows concise inventory of known profiles, aliases, and volume/container presence | N/A |
| `logs` | Shows recent container logs for the selected workspace profile | N/A |
| `alias` | Creates, removes, or lists alias names that point to workspace targets | N/A |
| `doctor` | Checks runtime availability, socket discovery, local state, and CLI installation visibility | N/A |
| `create` | Copies the built-in `project-example` template into a new destination folder | N/A |
| `build` | Builds the workspace image | N/A |
| `rebuild` | Purges the selected profile, rebuilds the image with `--no-cache`, then starts it | No |

### Output mode

Normal mode is intentionally concise.

```bash
conflux-workspace status
pnpm run workspace:start -- /path/to/project
```

Use `--verbose` when you want to see the underlying build logs, container
runtime output, or local install details.

```bash
conflux-workspace build --verbose
pnpm run workspace:rebuild -- --verbose /path/to/project
pnpm run workspace:install -- --verbose
```

Runtime commands such as `start`, `build`, `status`, `rm`, `purge`, and
`rebuild` also validate runtime access before execution and fail early with a
pointer to `conflux-workspace doctor` when the host runtime is not usable.

### Image selection and edge cases

Launcher behavior:

- The local wrapper always targets the local image built from this repo.
- The direct CLI now prefers the local image automatically when it already exists.
- If no local image exists, the direct CLI falls back to the published image.
- If the published image is unavailable or private, launch fails with guidance to build locally or pass an explicit image.

Common edge cases:

- Created project path exists but no image has been built yet: run `pnpm run workspace:build` first.
- Direct `build` is being run outside the repo root: pass `--context /path/to/devkit-workspace-web` or run it from the repo checkout.
- Profile remains in `list` after `rm`: only the container was removed; use `purge` to remove the volume-backed profile state.
- `start --profile ...` fails: the slug is no longer present in launcher state, so use the original path or alias.

### Create a new project from the example

Use `create` when you want a fresh copy of the built-in `project-example`
template in a folder you choose.

```bash
conflux-workspace create ./my-project
pnpm run workspace:create -- ./my-project
```

To create a brand new GitHub repository from the same scaffold, including the
Codespaces-ready `.devcontainer/` setup, use:

```bash
pnpm run project-example:create-repo -- my-project --owner your-org
```

Rules:

- A destination folder is required.
- The command fails if you do not provide a destination.
- The command fails if the destination exists and is not empty.
- The command copies the template contents into the destination root.
- `create` does not use `--alias` or `--profile` because it is creating a new folder, not targeting an existing profile.

### Bootstrap a GitHub repository from the example

The repo also includes a one-shot bootstrap helper for new hosted projects:

```bash
pnpm run project-example:create-repo -- my-project --owner your-org --private
```

What it does:

- assembles `scaffolds/project-example` into a new destination folder
- initializes a local git repository on `main`
- creates the first commit
- runs `gh repo create --source <dir> --push`

Useful options:

- `--public` or `--private`
- `--dir ./path/to/output`
- `--description "..."`
- `--homepage https://...`
- `--skip-gh` to only create the local repository without creating the remote yet

Prerequisites:

- `gh auth login` already completed
- `git config --global user.name ...`
- `git config --global user.email ...`

### Target selectors

Every lifecycle command targets one workspace profile. You can identify that
profile in four ways:

```bash
# Built-in project-example profile
conflux-workspace start

# Explicit project path
conflux-workspace start /path/to/project
conflux-workspace start --workspace /path/to/project

# Alias saved in launcher state
conflux-workspace start --alias demo

# Profile slug from list/status output
conflux-workspace purge --profile ws-123456789abc
```

Selector rules:

- No target means the built-in `project-example` profile.
- A path creates or reuses the deterministic profile for that filesystem path.
- An alias resolves to a built-in profile or saved path target.
- A profile slug is best for `status`, `stop`, `rm`, and `purge`.
- `start` and `rebuild` require the profile slug to exist in launcher state, because they must reconstruct the original target metadata.

Important lifecycle difference:

- `rm` removes only the container. The profile still appears in `list` if its volume still exists.
- `purge` removes both the container and the persisted volume, so the profile disappears from `list` unless some external resource with the same slug still exists.

### Discovery and alias workflow

```bash
# Show concise profile inventory
conflux-workspace list

# Show detailed status for all known profiles
conflux-workspace status

# Save aliases
conflux-workspace alias set demo /path/to/project
conflux-workspace alias set builtin

# List aliases
conflux-workspace alias

# Remove an alias
conflux-workspace alias rm demo
```

The launcher state is stored on the host at:

```bash
~/.config/conflux-workspace/state.json
```

That state file stores known profiles and aliases so the same names work across
published `npx` usage, direct local CLI installs, and the root wrapper scripts.

Open **http://localhost:8080** in your browser.

The built-in web apps can then be reached at:

- `http://localhost:3030` or `http://localhost:8080/proxy/3030/` — project example
- `http://localhost:7748` or `http://localhost:8080/proxy/7748/` — DevKit UI / REST server
- `http://localhost:8888` or `http://localhost:8080/proxy/8888/` — standalone DEX UI

### Using Docker Compose

```bash
# Start
docker compose up -d

# Stop (data preserved in volumes)
docker compose down

# View logs
docker compose logs -f
```

---

## Rebuild After Changes

### Dockerfile or package source changes

The builder stage compiles all TypeScript and repacks the binaries. A cached
incremental build reuses layers that haven't changed.

```bash
# Preferred local image build path (enables Docker BuildKit automatically)
pnpm image:build

# Incremental rebuild (uses layer cache where possible)
pnpm run workspace:build

# Full rebuild from scratch (no cache)
pnpm run workspace:build -- --no-cache

# Or with Docker Compose
DOCKER_BUILDKIT=1 docker compose build
docker compose build --no-cache
```

### Full reset (purge data + rebuild)

This removes the selected profile container and profile home volume, then
rebuilds from scratch with `--no-cache` and starts that profile again.

```bash
pnpm run workspace:rebuild
npx conflux-workspace rebuild
```

Equivalent manual steps:
```bash
conflux-workspace purge
conflux-workspace build --no-cache
conflux-workspace start
```

---

## Ports

| Port | Service |
|------|---------|
| `8080` | code-server (browser IDE) |
| `3030` | project example |
| `7748` | workspace backend REST API |
| `7749` | workspace file server used by the DEX UI |
| `8545` | Conflux eSpace RPC (EVM-compatible) |
| `8546` | Conflux eSpace WebSocket |
| `8888` | standalone DEX UI |
| `12537` | Conflux Core RPC |
| `12535` | Conflux Core WebSocket |

## Built-in Services

`docker-compose.yml` starts the main `devkit-web` container only. The two app stacks ship inside the image and are started separately:

- `.generated/project-example/docker-compose.yml` — locally assembled project example on `:3030`
- `dex-ui/docker-compose.yml` — standalone DEX UI on `:8888`

Inside the browser IDE, the status bars and commands start these stacks for you. From a terminal you can also run the compose files directly from the workspace.

---

## Mounting Your Own Project

### bind-mount via the wrapper

```bash
npx conflux-workspace start /path/to/your/project
```

The folder is mounted at `/workspace` and set as the workspace.

### bind-mount via Docker Compose

Uncomment the volume and environment lines in `docker-compose.yml`:

```yaml
environment:
  WORKSPACE: /workspace
volumes:
  - /path/to/your/project:/workspace
```

On first start, `opencode.json` is seeded into your project folder automatically
so the MCP server and AI skills are available immediately.

---

## Container Socket (DooD)

The container uses **Docker-outside-of-Docker**: the host container socket is
mounted so the workspace backend can manage child containers from inside the IDE.

The local wrapper scripts use the same socket auto-detection as the published
launcher. You can override it:

```bash
# Podman rootless
export DOCKER_SOCKET=/run/user/1000/podman/podman.sock

# Podman rootful
export DOCKER_SOCKET=/run/podman/podman.sock

# Docker (default)
export DOCKER_SOCKET=/var/run/docker.sock
```

---

## GitHub Copilot / AI Auth

Pass a GitHub token so Copilot and `opencode` authenticate automatically:

```bash
export GITHUB_TOKEN=ghp_...
npx conflux-workspace start
```

Inside the container, run `opencode auth login` and select **GitHub Copilot**
to use the token for AI-assisted Conflux development.

---

## Data Persistence

User data is stored in managed Docker/Podman volumes mounted at `/home/node`.
The volume name is derived from the loaded workspace profile, so the built-in
project and each custom path keep separate state instead of overwriting each
other when you switch targets.

Optional aliases are stored in a host-side launcher state file under your
config directory, so both `npx conflux-workspace` and the local `pnpm run`
scripts resolve the same saved targets.

- code-server settings and extensions state
- workspace backend keystore and chain data
- Workspace history

The profile volume survives `conflux-workspace stop` and `conflux-workspace rm`.
Only `conflux-workspace purge` removes it for that workspace profile.

Use `conflux-workspace list` for a concise profile inventory and
`conflux-workspace status` for the fuller runtime-oriented view.

If you return to the same path later, the wrapper restores the same profile.
If you open a different path, the wrapper switches to a different profile and
does not reuse the previous workspace state.

---

## Development

Build and test all packages locally (requires Node ≥ 22 and pnpm ≥ 9):

```bash
pnpm install
pnpm run build:all          # compile all packages
pnpm run package:extension  # produce dist/devkit.vsix
```

Build specific packages:

```bash
pnpm run build:shared
pnpm run build:mcp
pnpm run build:cli
pnpm run build:extension
```

---

## Hackathon Submission Profile

### Project Name
CFX DevKit Web

### Hackathon
Global Hackfest 2026 (2026-03-23 to 2026-04-20)

### Team
Solo submission (team size: 1).

### Problem Statement
Developers often need multiple tools and services to start building blockchain apps, which increases setup time and integration risk.

### Solution
This repository provides a self-contained Conflux development workspace with browser IDE, local node lifecycle, deployment flows, DEX simulation, and AI tooling.

### Go-to-Market Plan
The project targets Web3 developers, hackathon participants, and internal platform teams needing a reproducible Conflux stack. Distribution is via open-source repository + template-based workspace creation. Growth is driven through hackathon adoption, developer docs, and reusable templates.

### Conflux Integration
- Conflux eSpace/Core local lifecycle via DevKit.
- Contract compile/deploy/track flow in `scaffolds/project-example` and generated project workspaces.
- Public-network deployment path (testnet/mainnet) via `scaffolds/project-example/scripts/deploy-public-contract.mjs`.
- Address registry artifact for frontend contract resolution.

### Demo Links
Add these before final submission:
- Live demo URL:
- Demo video URL:
- Participant intro video URL:

### Smart Contracts (Evidence)
Deployment tracking source of truth:
- `scaffolds/project-example/deployments/contracts.json`

Frontend address artifact generated from tracking:
- `.generated/project-example/dapp/src/generated/contracts-addresses.ts`

### Known Limitations
- Public-network deployment requires explicit RPC endpoint and funded deployer private key.
- Testnet DEX liquidity depth is constrained by faucet budgets.

### Future Improvements
- Add CI validation to verify deployment tracking and artifact consistency.
- Add guided scripts for automatic testnet/mainnet proof generation.

### License
This repository is licensed under Apache-2.0. See `LICENSE`.

### Acknowledgments
- Conflux Network
- Global Hackfest 2026 organizers and mentors
