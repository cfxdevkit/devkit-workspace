---
applyTo: "**"
---

# Conflux Ecosystem — Public Network & Documentation Fallback

> **Priority rule:** Always prefer the devkit MCP tools (`conflux_*`, `blockchain_*`, `dex_*`, `workspace_*`, `backend_health`) for local development. This instruction file is a **fallback** for tasks the local devkit cannot handle:
> - Deploying or verifying contracts on **testnet / mainnet**
> - Looking up **official documentation** URLs
> - Querying **public chain state** via RPC or ConfluxScan API
> - Configuring **MetaMask / wallets** for public networks

---

## 0 · DEX — Local Workflows

> The MCP server exposes only three DEX tools: `dex_status`, `dex_deploy`, `dex_seed_from_gecko`.
> Tools like `dex_list_pairs`, `dex_swap`, `dex_pool_info`, `dex_create_pair`, `dex_add_liquidity` **do not exist** in the current MCP layer.
> DEX runtime operations (pair inspection, swaps, liquidity) must go through `backend_api_call` against the DEX REST endpoints.

### Available MCP DEX tools

| Tool | Purpose |
|------|---------|
| `dex_status` | Check deployment and seeding state |
| `dex_deploy` | Deploy the Uniswap V2 stack (factory, router, WETH9) |
| `dex_seed_from_gecko` | Seed pools from CoinGecko price data |

### DEX REST endpoints (via `backend_api_call`)

The backend exposes these at base path `/api/dex`:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/dex/status` | Deployment + seeding state |
| GET | `/api/dex/manifest` | Deployed contract addresses (factory, router02, WETH9) |
| POST | `/api/dex/deploy` | Deploy DEX stack |
| POST | `/api/dex/seed` | Seed pools |
| GET | `/api/dex/translation-table` | Token symbol → address mapping |
| GET | `/api/dex/pricing/wcfx-usd` | Current WCFX/USD price |
| GET | `/api/dex/source-pools/suggestions` | Available pool suggestions |

### Correct local DEX workflow

```
Step 1: dex_status                             → check if deployed and seeded
Step 2: dex_deploy                             → deploy if not deployed
Step 3: dex_seed_from_gecko                    → seed pools with price data
Step 4: backend_api_call GET /api/dex/manifest → get contract addresses
Step 5: backend_api_call GET /api/dex/translation-table → token symbol/address map
```

### Address hierarchy (for direct contract interaction)

| Type | What it is | How to get it |
|------|-----------|---------------|
| **Token address** | ERC-20 contract (`MirrorERC20`, `WETH9`) | `backend_api_call GET /api/dex/translation-table` |
| **Pair address** (pool) | `UniswapV2Pair` contract | Read from factory via `blockchain_espace_call_contract` |
| **Router/Factory address** | DEX infrastructure | `backend_api_call GET /api/dex/manifest` |

### Common mistakes

1. **Using `dex_list_pairs` or `dex_swap`** — these tools do not exist; use `backend_api_call` instead.
2. **Assuming token order** — Uniswap V2 sorts by address; verify via translation table.
3. **Running seed before deploy** — deploy order: `dex_deploy` → `dex_seed_from_gecko`.

---

## 1 · Network Configuration

| Network | Chain | RPC URL | Chain ID | Block Explorer | ConfluxScan API |
|---------|-------|---------|----------|----------------|-----------------|
| **Mainnet** | eSpace | `https://evm.confluxrpc.com` | 1030 | https://evm.confluxscan.org | https://evmapi.confluxscan.org |
| **Testnet** | eSpace | `https://evmtestnet.confluxrpc.com` | 71 | https://evmtestnet.confluxscan.org | https://evmapi-testnet.confluxscan.org |
| **Mainnet** | Core | `https://main.confluxrpc.com` | 1029 | https://confluxscan.org | — |
| **Testnet** | Core | `https://test.confluxrpc.com` | 1 | https://testnet.confluxscan.org | — |
| **Local** | eSpace | `http://127.0.0.1:8545` | 2030 | — | — |
| **Local** | Core | `http://127.0.0.1:12537` | 2029 | — | — |

**Address formats:**
- **eSpace:** Ethereum-style `0x` hex (42 chars).
- **Core Space:** CIP-37 base32, e.g. `cfx:aatktb2te25ub7dmyag3p8bbdgr31vrbeackztm2rj`.

---

## 2 · Public Network Deployment (testnet / mainnet)

> **Local deployment?** Use MCP tools: `conflux_bootstrap_deploy`, `conflux_deploy`, or `blockchain_espace_deploy_contract`.

### Hardhat

```js
// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: { version: "0.8.28", settings: { evmVersion: "paris" } },
  networks: {
    confluxTestnet: {
      url: "https://evmtestnet.confluxrpc.com",
      chainId: 71,
      accounts: [process.env.PRIVATE_KEY],
    },
    confluxMainnet: {
      url: "https://evm.confluxrpc.com",
      chainId: 1030,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
```

Deploy: `npx hardhat run scripts/deploy.js --network confluxTestnet`

Verify: `npx hardhat verify --network confluxTestnet <ADDRESS> <CONSTRUCTOR_ARGS>`
(requires `hardhat-conflux-verify` plugin)

### Foundry

```bash
# Deploy
forge create src/MyContract.sol:MyContract \
  --rpc-url https://evmtestnet.confluxrpc.com \
  --private-key $PRIVATE_KEY \
  --gas-estimate-multiplier 200

# Verify
forge verify-contract <ADDRESS> src/MyContract.sol:MyContract \
  --verifier-url https://evmapi-testnet.confluxscan.org/api \
  --etherscan-api-key $CONFLUXSCAN_API_KEY \
  --chain-id 71 \
  --watch
```

### Remix

1. Open https://remix.ethereum.org
2. Compile with EVM target **Paris** (Conflux does not support Shanghai+ opcodes like PUSH0)
3. Deploy → Injected Provider (MetaMask) → select Conflux network

### Gotchas

- Always use `evmVersion: "paris"` (or earlier) — PUSH0 (Shanghai) is not supported on Conflux.
- Foundry `--gas-estimate-multiplier 200` — Conflux gas estimation can under-report.
- Hardhat verification requires `hardhat-conflux-verify`, not the default etherscan plugin.

---

## 3 · App Integration

### viem

```js
import { defineChain } from "viem";

export const confluxESpaceTestnet = defineChain({
  id: 71,
  name: "Conflux eSpace Testnet",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmtestnet.confluxrpc.com"] } },
  blockExplorers: { default: { name: "ConfluxScan", url: "https://evmtestnet.confluxscan.org" } },
});

export const confluxESpace = defineChain({
  id: 1030,
  name: "Conflux eSpace",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm.confluxrpc.com"] } },
  blockExplorers: { default: { name: "ConfluxScan", url: "https://evm.confluxscan.org" } },
});
```

### MetaMask Network Config

| Field | Testnet | Mainnet |
|-------|---------|---------|
| Network Name | Conflux eSpace Testnet | Conflux eSpace |
| RPC URL | `https://evmtestnet.confluxrpc.com` | `https://evm.confluxrpc.com` |
| Chain ID | 71 | 1030 |
| Currency Symbol | CFX | CFX |
| Block Explorer | `https://evmtestnet.confluxscan.org` | `https://evm.confluxscan.org` |

### Testnet Faucet

https://efaucet.confluxnetwork.org — get testnet CFX for eSpace.

### Cross-Space Bridge

https://confluxhub.io/espace-bridge/cross-space

---

## 4 · Official Documentation

### Spaces
| Topic | URL |
|-------|-----|
| Spaces overview | https://doc.confluxnetwork.org/docs/general/conflux-basics/spaces |
| eSpace overview | https://doc.confluxnetwork.org/docs/espace/Overview |
| Core Space overview | https://doc.confluxnetwork.org/docs/core/Overview |

### eSpace (EVM-Compatible)
| Topic | URL |
|-------|-----|
| Developer quickstart | https://doc.confluxnetwork.org/docs/espace/DeveloperQuickstart |
| EVM compatibility | https://doc.confluxnetwork.org/docs/espace/build/evm-compatibility |
| Deploy with Hardhat/Foundry | https://doc.confluxnetwork.org/docs/espace/tutorials/deployContract/hardhatAndFoundry |
| Deploy with Remix | https://doc.confluxnetwork.org/docs/espace/tutorials/deployContract/remix |
| Verify contracts | https://doc.confluxnetwork.org/docs/espace/tutorials/VerifyContracts |
| RPC providers | https://doc.confluxnetwork.org/docs/espace/build/infrastructure/RPC-Provider |

### Core Space
| Topic | URL |
|-------|-----|
| Storage collateral (sponsor) | https://doc.confluxnetwork.org/docs/core/core-space-basics/storage |
| Sponsor mechanism | https://doc.confluxnetwork.org/docs/core/core-space-basics/sponsor-mechanism |
| Internal contracts | https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts |
| Base32 addresses | https://doc.confluxnetwork.org/docs/core/core-space-basics/addresses |
| Core JSON-RPC reference | https://doc.confluxnetwork.org/docs/core/build/json-rpc/ |

### General
| Topic | URL |
|-------|-----|
| Tokenomics (CFX) | https://doc.confluxnetwork.org/docs/general/conflux-basics/economics |
| Transfer across spaces | https://doc.confluxnetwork.org/docs/general/tutorials/transferring-funds/transfer-funds-across-spaces |
| Grants | https://doc.confluxnetwork.org/docs/general/build/grants |

---

## 5 · Read-Only Chain Queries (public networks)

> **Local queries?** Use MCP tools: `blockchain_espace_get_balance`, `blockchain_espace_get_block_number`, `blockchain_espace_call_contract`, etc.

### Using `cast` (Foundry)

```bash
cast block-number --rpc-url https://evmtestnet.confluxrpc.com
cast balance 0xADDRESS --ether --rpc-url https://evmtestnet.confluxrpc.com
cast receipt 0xTXHASH --rpc-url https://evmtestnet.confluxrpc.com
cast call 0xTOKEN "balanceOf(address)(uint256)" 0xADDRESS --rpc-url https://evmtestnet.confluxrpc.com
cast gas-price --rpc-url https://evmtestnet.confluxrpc.com
```

### Using `curl` (JSON-RPC)

```bash
# Block number
curl -s -X POST https://evmtestnet.confluxrpc.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}'

# Balance
curl -s -X POST https://evmtestnet.confluxrpc.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xADDRESS","latest"],"id":1}'
```

---

## 6 · ConfluxScan API

Etherscan-compatible REST API for eSpace.

| Base URL | Network |
|----------|---------|
| `https://evmapi.confluxscan.org` | Mainnet |
| `https://evmapi-testnet.confluxscan.org` | Testnet |

**Swagger:** https://evmapi.confluxscan.org/doc

```bash
# Contract ABI
curl -s "https://evmapi-testnet.confluxscan.org/api?module=contract&action=getabi&address=0xCONTRACT"

# Account tx list (latest 10)
curl -s "https://evmapi-testnet.confluxscan.org/api?module=account&action=txlist&address=0xADDRESS&page=1&offset=10&sort=desc"

# Token transfers
curl -s "https://evmapi-testnet.confluxscan.org/api?module=account&action=tokentx&address=0xADDRESS&page=1&offset=10&sort=desc"
```

Add `&apikey=KEY` for higher rate limits.

---

## 7 · Transaction Analysis (public networks)

### Failure diagnosis
1. `cast receipt 0xTXHASH --rpc-url <RPC>`
2. Check `status`: `0x0` = reverted, `0x1` = success
3. Look for `txExecErrorMsg` in the receipt for revert reason

### Stuck / pending tx
1. Compare nonces: `cast nonce ADDR` (latest) vs `cast nonce ADDR --block pending`
2. If pending > latest → txs are queued; earliest nonce must confirm or be replaced

### Transaction lifecycle (Conflux eSpace)
```
Pending → Mined → Executed (~5 epochs) → Confirmed (~50 epochs) → Finalized (~4-6 min)
```
Receipt may be `null` until the tx is executed.
Ref: https://doc.confluxnetwork.org/docs/core/core-space-basics/transactions/lifecycle
