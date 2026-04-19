# Conflux DevKit — Project Example

A full-stack dApp scaffold for [Conflux eSpace](https://doc.confluxnetwork.org/docs/espace/Overview), powered by [Conflux DevKit](https://github.com/cfxdevkit).

The project ships a local Conflux node, a devkit backend, and a ready-to-use React dApp — all inside a one-click devcontainer. No manual setup required.

## What's Inside

| Component | Description |
|-----------|-------------|
| **ExampleCounter** | Solidity contract with counter, lock, and withdrawal logic |
| **React dApp** | Vite + React + wagmi UI connected to the local chain |
| **DevKit Backend** | Always-on backend (port 7748) managing the local Conflux node, keystore, and deployments |
| **DEX UI** | Optional Uniswap V2 DEX for local token trading (port 8888) |
| **MCP Server** | AI-agent integration — deploy contracts, query chain state, and manage the stack from Copilot or Claude |

## Quick Start

### Option 1 — VS Code Dev Container (recommended)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and [VS Code](https://code.visualstudio.com/) with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension
2. Clone this repo and open it in VS Code
3. When prompted **"Reopen in Container"**, click it (or run `Dev Containers: Reopen in Container` from the command palette)
4. Wait for the container to build — the devkit backend and Conflux node start automatically
5. Open the integrated terminal and run:
   ```bash
   pnpm dev
   ```
6. Open `http://localhost:3001` in your browser

### Option 2 — GitHub Codespaces

1. Click **Code → Codespaces → Create codespace on main** from the GitHub repo page
2. Wait for the codespace to provision — everything starts automatically
3. In the codespace terminal:
   ```bash
   pnpm dev
   ```
4. Codespaces will show a notification to open the forwarded port — click **Open in Browser**

### Option 3 — VS Code with GitHub Codespaces extension

1. Install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code
2. Run `Codespaces: Create New Codespace` from the command palette and select this repo
3. The container builds remotely — same experience as a local devcontainer
4. Run `pnpm dev` and open the forwarded port

## Working with AI Agents (MCP)

This project includes full MCP (Model Context Protocol) integration. When you open it in VS Code with GitHub Copilot, the devkit MCP server is automatically available.

**Cold start workflow:**

1. Ask Copilot to run `conflux_status` — it will report the stack state and next step
2. Follow the `nextStep` instruction (usually the stack is already ready)
3. Ask it to deploy contracts, query balances, manage the DEX, etc.

The MCP server exposes tools for node lifecycle, contract deployment, DEX operations, and chain queries. See [CLAUDE.md](CLAUDE.md) for the full tool reference.

## Project Structure

```
├── contracts/            Solidity source + compiled artifact
│   ├── Counter.sol         ExampleCounter contract
│   ├── generated/          Compiled ABI + artifact (JS module)
│   └── scripts/            Compile script
├── dapp/                 React frontend
│   ├── src/
│   │   ├── components/     UI components
│   │   ├── generated/      Auto-generated contract hooks & addresses
│   │   ├── hooks/          Custom React hooks
│   │   └── providers.tsx   Wallet + query providers
│   └── vite.config.ts     Dev server config
├── scripts/              Root utility scripts
├── .devcontainer/        Container configuration
├── .vscode/              Editor settings & MCP config
└── .github/              Copilot instructions
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the dApp dev server (port 3001) |
| `pnpm build` | Production build |
| `pnpm serve` | Serve production build (port 3030) |
| `pnpm codegen` | Compile contracts + generate artifacts |
| `pnpm deploy` | Deploy contracts to local chain |
| `pnpm deploy:testnet` | Deploy to Conflux eSpace testnet |
| `pnpm deploy:mainnet` | Deploy to Conflux eSpace mainnet |
| `pnpm doctor` | Health check for the workspace |
| `pnpm contracts:compile` | Compile Solidity contracts |
| `pnpm contracts:list` | List tracked contract deployments |
| `pnpm sync:network` | Sync chain config from devkit backend |
| `pnpm smoke:workspace` | Full workspace smoke test (compile + build) |

## Ports

| Port | Service |
|------|---------|
| 3001 | Dapp dev server |
| 3030 | Dapp production server |
| 7748 | DevKit backend API |
| 8545 | Conflux eSpace JSON-RPC |
| 8888 | DEX UI |
| 12537 | Conflux Core JSON-RPC |

## Production Deployment

Build and run a standalone container:

```bash
pnpm stack:up        # build and start via docker compose
pnpm stack:logs      # follow container logs
pnpm stack:down      # stop
```

Or deploy to Conflux testnet/mainnet:

```bash
# Set your deployer private key
export PRIVATE_KEY=0x...

pnpm deploy:testnet  # deploy to eSpace testnet (chain ID 71)
pnpm deploy:mainnet  # deploy to eSpace mainnet (chain ID 1030)
```

## License

MIT
