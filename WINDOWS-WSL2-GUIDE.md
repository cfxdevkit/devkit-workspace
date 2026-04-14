# CFX DevKit on Windows with WSL2

Date: 2026-04-14
Status: Practical local setup guide

This guide explains how to run the project on **Windows using WSL2** with the published CLI:

- `npx conflux-workspace ...`

It is written for the setup you already have:

- Docker Desktop or Podman Desktop installed
- WSL2 enabled
- Ubuntu installed in WSL2

This is the recommended Windows path for the project.

---

## Recommended model

Use the project like this:

- Windows runs the browser and wallet
- WSL2 runs the terminal and local dev commands
- Docker Desktop or Podman Desktop provides the Linux containers
- the app is opened in the Windows browser on `http://localhost:8080`

This is the most reliable way to avoid proxy and wallet issues.

---

## 1. Open your Ubuntu WSL2 shell

Use Windows Terminal or another terminal app and open your Ubuntu WSL2 environment.

You can confirm you are inside WSL2 with:

```bash
uname -a
```

You should see a Linux environment.

---

## 2. Install Node.js 22 inside WSL2

If Node is not already installed in Ubuntu, install it there.

Recommended method:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node -v
npm -v
```

If you use `zsh`, replace `source ~/.bashrc` with the appropriate shell startup file.

---

## 3. Make sure Docker or Podman is reachable from WSL2

Before using the CLI, verify the container runtime is accessible from Ubuntu.

For Docker:

```bash
docker info
```

For Podman:

```bash
podman info
```

If one of these commands works, the CLI should be able to detect the runtime.

---

## 4. Run the published CLI health check

From your WSL2 terminal, run:

```bash
npx conflux-workspace doctor
```

This checks:

- runtime detection
- socket visibility
- CLI environment
- image resolution
- local state information

If this fails, fix that before continuing.

---

## 5. Start the workspace

At the moment, the start command should be used with a directory target.

For a project folder you already have:

```bash
cd /path/to/your/project
npx conflux-workspace start .
```

If startup succeeds, the CLI should print the local URL.

Open this in your **Windows browser**:

```text
http://localhost:8080
```

---

## 6. Use your own project folder

If you want a new project based on the built-in scaffold:

```bash
mkdir -p ~/projects
cd ~/projects
npx conflux-workspace create ./my-project
cd ./my-project
npx conflux-workspace start .
```

If you already have a project folder:

```bash
cd /path/to/your/project
npx conflux-workspace start .
```

The folder is mounted into the workspace container and used as the active workspace.

---

## 7. Daily commands

Use these from WSL2:

```bash
npx conflux-workspace status
npx conflux-workspace list
npx conflux-workspace stop .
npx conflux-workspace rm .
npx conflux-workspace purge .
```

Meaning:

- `status` shows the current workspace state
- `list` shows known profiles and aliases
- `stop` stops the container but keeps data
- `rm` removes the container but keeps persisted state
- `purge` removes the full workspace profile and persisted data

---

## 8. Which browser should be used

Use the **Windows host browser**, not a browser inside the container.

Recommended:

- Chrome
- Edge

This is important for wallet support.

For Fluent wallet testing:

- install Fluent in the Windows browser
- open the workspace URL from Windows
- connect the wallet there

Do **not** depend on Codespaces or remote browser proxying for wallet-critical flows.

---

## 9. Local code-server vs GitHub Codespaces

There is an important distinction between the two browser-based modes.

### Local code-server image

The local code-server image remains a supported path and is expected to work with the current proxy setup.

Use it for:

- browsing and editing the workspace in the browser
- running the local containerized development environment
- wallet-enabled flows when tested through the supported local setup

### GitHub Codespaces and the devcontainer path

The issue is specifically with the GitHub Codespaces and devcontainer path.

Current status:

- it will be kept
- it is a work in progress
- it is currently missing a reliable solution for Fluent proxied requests
- it should still be usable for general remote work and likely for testnet and mainnet flows that are not blocked by the Fluent proxy behavior

Because the main scope of the project is a local development environment, that unresolved Fluent behavior is still a blocking issue for the primary experience.

For the main dapp and wallet interactions, still prefer:

- local VS Code
- Windows browser
- WSL2 terminal

---

## 10. Recommended workflow for this repository

### Option A — just use the published CLI

This is the simplest path when you already have a project directory:

```bash
cd /path/to/your/project
npx conflux-workspace doctor
npx conflux-workspace start .
```

### Option B — work from the repository locally

If you want to edit and develop this repository itself:

```bash
cd ~/projects
git clone <repo-url>
cd devkit-workspace
corepack enable
corepack prepare pnpm@latest --activate
pnpm install
pnpm run workspace:doctor
pnpm run workspace:start
```

This is the better path for maintainers.

---

## 11. Docker vs Podman on Windows

### Docker Desktop

This is the easiest option for most Windows users.

If Docker is installed and working in WSL2, the CLI should usually detect it automatically.

### Podman Desktop

This can also work, but it may require extra validation depending on socket exposure and desktop configuration.

If both are installed, you can force one runtime explicitly:

```bash
npx conflux-workspace doctor --runtime docker
npx conflux-workspace start --runtime docker
```

or:

```bash
npx conflux-workspace doctor --runtime podman
npx conflux-workspace start --runtime podman
```

If you are unsure, start with Docker Desktop first.

---

## 12. Recommended file location strategy on Windows

Prefer keeping active projects inside the WSL2 filesystem, for example:

```text
/home/<your-user>/projects
```

This is usually more reliable than working directly from mounted Windows paths like:

```text
/mnt/c/...
```

Benefits:

- better file performance
- better watcher behavior
- fewer permission surprises
- more Linux-like tooling behavior

---

## 13. Troubleshooting

### Problem: `npx conflux-workspace doctor` says no runtime found

Check that Docker Desktop or Podman Desktop is running and reachable from WSL2:

```bash
docker info
podman info
```

### Problem: Edge cannot connect to localhost:8080 even though the CLI says it is running

This is usually a networking-mode issue.

On WSL2, the workspace should use **published ports** so the Windows host can reach the container on localhost. If the launcher behaves like native Linux and uses host networking instead, Windows browser access may fail.

What to do:

- use the latest launcher version containing the WSL2 networking fix
- if testing from this repository, use the repo version of the CLI
- rerun the workspace after the update
- if needed, force Docker explicitly with `--runtime docker`

Example:

```bash
cd /path/to/your/project
npx conflux-workspace doctor --runtime docker
npx conflux-workspace start . --runtime docker
```

### Problem: browser opens but wallet does not work correctly

Make sure you are:

- using the Windows host browser
- not relying on a remote proxy path
- testing on `localhost`

### Problem: bind mounts behave strangely

Move the project into the WSL2 filesystem instead of `/mnt/c/...`.

### Problem: ports are already in use

Check whether another local process is already using the expected ports.

### Problem: the workspace starts but child workloads fail

Run:

```bash
npx conflux-workspace doctor
```

Then confirm the runtime socket is visible to the CLI.

---

## 14. Minimal quickstart

If everything is already installed, the shortest usable flow is:

```bash
cd /path/to/your/project
npx conflux-workspace doctor
npx conflux-workspace start .
```

Then open:

```text
http://localhost:8080
```

---

## 15. Recommended next validation

Once the workspace is running on Windows, verify these in order:

1. the page opens on `localhost:8080`
2. the workspace starts without runtime errors
3. the project folder is mounted correctly
4. the local chain/backend services respond
5. Fluent connects from the Windows browser
6. wallet-dependent app flows work locally

---

## Final recommendation

For Windows, the supported working model should be:

- **WSL2 for terminal and repo execution**
- **Docker Desktop or Podman Desktop for containers**
- **Windows browser for wallet interaction**
- **local VS Code as the main editor**
- **code-server as an optional secondary path**

This keeps the workflow close to Linux while still being practical for Windows development.