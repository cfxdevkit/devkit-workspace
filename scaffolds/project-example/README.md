# CFX DevKit — Project Example

A pnpm monorepo reference project for the CFX DevKit workspace. Contains a Solidity contract, a React dApp, and a codegen pipeline that connects them.

## Structure

```text
├── pnpm-workspace.yaml      # workspaces: contracts, dapp, ui-shared
├── package.json              # root lifecycle scripts
├── Dockerfile                # production container build
├── docker-compose.yml        # stack: dapp on :3030
├── deployments/              # persistent multi-network deployment tracking
├── contracts/                # workspace package — pure data, no framework deps
│   ├── Counter.sol           # example Solidity contract
│   ├── scripts/compile.mjs   # solc compilation → generated/
│   └── generated/            # artifacts.ts, index.ts (gitignored)
├── dapp/                     # workspace package, depends on "contracts"
│   ├── wagmi.config.ts       # wagmi codegen: reads contracts/generated/ → src/generated/
│   ├── src/                  # React UI components
│   │   └── generated/        # hooks.ts — typed wagmi bindings (gitignored)
│   ├── server.ts             # production Node.js server
│   └── vite.config.ts        # dev server with SIWE auth + proxy
├── ui-shared/                # shared React/ui primitives used by the dapp
└── scripts/                  # root-level lifecycle scripts
    ├── doctor.mjs            # DevKit readiness checks
    ├── deploy-contract.mjs   # compile + deploy via DevKit API
    ├── deploy-public-contract.mjs  # deploy to public RPCs
    └── list-contracts.mjs    # list deployed contracts
```

## Quick Start

```bash
pnpm install
pnpm doctor
pnpm codegen
pnpm dev
```

## Commands

| Command | Description |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm doctor` | Check DevKit server, keystore, node, and RPC |
| `pnpm codegen` | Compile Counter.sol and generate typed wagmi hooks |
| `pnpm deploy` | Deploy ExampleCounter via DevKit API |
| `pnpm deploy:public` | Deploy ExampleCounter to a public RPC (testnet/mainnet) |
| `pnpm deploy:testnet` | Deploy to eSpace testnet (requires RPC + private key env) |
| `pnpm deploy:mainnet` | Deploy to eSpace mainnet (requires RPC + private key env) |
| `pnpm contracts:list` | List deployed contracts |
| `pnpm dev` | Run codegen + start Vite dev server |
| `pnpm build` | Run codegen + production build + compile server |
| `pnpm serve` | Serve the production build on :3030 |
| `pnpm lint` | Run Biome lint checks for the project workspace |
| `pnpm format` | Apply Biome formatting for the project workspace |
| `pnpm stack:up` | Build + start the Docker container |
| `pnpm stack:down` | Stop the Docker container |
| `pnpm stack:logs` | Follow container logs |

## Generated Contract Address Artifact

Contract deployment (`pnpm deploy`) now updates a frontend artifact at:

- `dapp/src/generated/contracts-addresses.ts`

Schema example:

```ts
export const CONTRACT_ADDRESSES_BY_CHAIN_ID = {
    2030: {
        ExampleCounter: '0x1234...abcd',
        TokenA: '0xabcd...1234',
    },
    71: {
        ExampleCounter: '0x5678...ef01',
    },
} as const;
```

The dapp resolves addresses by `chainId` + `contractName` instead of querying `/api/contracts/deployed` at runtime.

## Deployment Tracking (Local + Public Networks)

Persistent deployment tracking file:

- `deployments/contracts.json`

This file is the source of truth for deployments across networks and is updated by:

- `pnpm deploy` (local DevKit deployment)
- `pnpm deploy:public` (public RPC deployment)

`dapp/src/generated/contracts-addresses.ts` is generated from this tracking file so local/testnet/mainnet addresses can coexist.

### Public network deployment

Required environment variables:

- `DEPLOY_RPC_URL`
- `DEPLOY_PRIVATE_KEY`
- `DEPLOY_CHAIN_ID` (default `71`)
- `DEPLOY_NETWORK` (optional label, auto-derived when omitted)

Example testnet command:

```bash
DEPLOY_RPC_URL=https://evmtestnet.confluxrpc.com \
DEPLOY_PRIVATE_KEY=0xYOUR_PRIVATE_KEY \
DEPLOY_CHAIN_ID=71 \
DEPLOY_NETWORK=testnet \
pnpm run deploy:public
```

Example mainnet command:

```bash
DEPLOY_RPC_URL=https://evm.confluxrpc.com \
DEPLOY_PRIVATE_KEY=0xYOUR_PRIVATE_KEY \
DEPLOY_CHAIN_ID=1030 \
DEPLOY_NETWORK=mainnet \
pnpm run deploy:public
```

### Production image build behavior

The Docker image build also writes this artifact (even when local DevKit is not reachable during build).
During that build, `pnpm --filter dapp deploy --legacy deploy` generates a temporary standalone `deploy/` runtime with real `node_modules`.
That `deploy/` directory is build output only and is intentionally ignored from source control.

Override options (simple mode):

- `CONTRACT_ADDRESSES_FILE` — path (inside the generated project build context) to a JSON file containing the full map
- `EXAMPLE_COUNTER_ADDRESS` + `EXAMPLE_COUNTER_CHAIN_ID` — quick override for the example contract

Examples:

```bash
# Quick single-contract override
EXAMPLE_COUNTER_ADDRESS=0x1234...abcd EXAMPLE_COUNTER_CHAIN_ID=71 pnpm stack:up

# Full map override via file
CONTRACT_ADDRESSES_FILE=./contracts-addresses.override.json pnpm stack:up
```

## How It Works

### Codegen Pipeline

1. `contracts/scripts/compile.mjs` compiles `Counter.sol` with solc and writes `contracts/generated/artifacts.ts` (ABI + bytecode) and `contracts/generated/ExampleCounter.json`
2. `@wagmi/cli` in the dapp reads the JSON artifact and generates `dapp/src/generated/hooks.ts` with typed React hooks and actions
3. The `contracts` barrel `generated/index.ts` exports pure ABI + bytecode data
4. The dapp imports wagmi hooks from its local generated file and can import raw artifacts from the workspace package:

```tsx
// Typed wagmi hooks (from dapp's local codegen)
import { useReadExampleCounterValue } from '../generated/hooks';

// Raw ABI and bytecode (from the contracts workspace package)
import { exampleCounterAbi, exampleCounterBytecode } from 'contracts';
```

### Development

The Vite dev server proxies `/api/*` to DevKit (`:7748`) and `/rpc` to the eSpace JSON-RPC (`:8545`). SIWE authentication is handled in-process.

### Production

The Node.js server in `dapp/server.ts` serves the built SPA and proxies to DevKit and RPC. The Dockerfile uses `pnpm --filter dapp deploy --legacy deploy` to assemble a standalone production runtime under `deploy/` during image builds.

## Prerequisites

Start the local DevKit services first:

1. Start DevKit server ("Conflux: Start DevKit Server")
2. Initialize keystore
3. Start the local Conflux node

Then verify with `pnpm doctor`.

## Tech Stack

- **Monorepo**: pnpm workspaces
- **Frontend**: React 18, wagmi 2, viem 2, Vite 6
- **Contracts**: Solidity 0.8, solc, @wagmi/cli codegen
- **Backend**: minimal Node.js server
- **Auth**: SIWE (Sign-In with Ethereum)
- **Chain**: local Conflux eSpace devnet (chainId 2030)
