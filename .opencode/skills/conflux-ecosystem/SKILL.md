---
name: conflux-ecosystem
description: Conflux public-network fallback — deploy/verify on testnet/mainnet, official documentation links, ConfluxScan API, and read-only chain queries. Use ONLY when the devkit MCP tools do not cover the task (e.g. public network deployment, contract verification, doc lookups).
---

# Conflux Ecosystem (fallback skill)

> **Priority rule:** Always prefer the devkit MCP tools (`workspace_*`, `docker_available`, `conflux_*`, `blockchain_*`, `cfxdevkit_*`, `dex_*`) for local development. This skill is a **fallback** for tasks the local devkit cannot handle:
> - Deploying or verifying contracts on **testnet/mainnet**
> - Looking up **official documentation** URLs
> - Querying **public chain state** via RPC or ConfluxScan API
> - Configuring **MetaMask / wallets** for public networks

---

## ⚡ Cold Start Guide — FOLLOW THIS ORDER EXACTLY

> When the user opens the workspace for the first time (or after a restart), follow these steps **in order** without asking the user to click anything in VS Code.

### Step 1 — Start the devkit server
```
conflux_server_start
```
- If it returns "already running" → skip to step 2.
- Wait for "server started and ready" confirmation.
- **Never ask the user to click "Start DevKit Server" — the MCP tool handles it.**

### Step 2 — Check full lifecycle status
```
conflux_status
```
- Read the `Next step` field and follow it exactly.

### Step 3 — Initialize keystore (first time only)
```
conflux_setup_init
```
- Only needed once. If keystore already initialized → skip.
- **Save the returned mnemonic** — show it prominently to the user.

### Step 4 — Unlock keystore (if locked)
```
conflux_keystore_unlock  { password: "<password>" }
```
- Only needed if `conflux_status` reports keystore locked.

### Step 5 — Start the node
```
conflux_node_start
```
- On success you get Core RPC `:12537` and eSpace RPC `:8545`.
- 10 genesis accounts are pre-funded with 1,000,000 CFX each.

### Step 6 — Ready
- Call `conflux_accounts` to list funded accounts.
- Deploy contracts with `conflux_bootstrap_deploy` or `cfxdevkit_compile_and_deploy`.

> **Stuck / corrupted state?** Call `conflux_node_wipe_restart` for a clean slate (preserves mnemonic, wipes chain data).

---

## 0 · DEX Tools — Address Types and Workflows

> This section is critical. Confusing pair addresses with token addresses is the most common mistake.

### Address hierarchy

The V2 DEX has **three distinct address types**. They are never interchangeable:

| Type | What it is | Used in |
|------|-----------|---------|
| **Token address** | ERC-20 contract (`MirrorERC20`, `WETH9`) | `dex_swap` tokenIn/tokenOut, `dex_create_pair` tokenA/tokenB, `dex_add_liquidity`, `dex_pool_info` tokenA/tokenB |
| **Pair address** (pool) | `UniswapV2Pair` contract — holds reserves, issues LP tokens | `dex_pool_info` pairAddress only |
| **Router/Factory address** | Internal DEX deployment state maintained by the tools and DEX service | Never pass manually — tools resolve it for you |

**Rule: `dex_swap` always takes TOKEN addresses, never pair/pool addresses.**

### Finding token addresses

`dex_list_pairs` is the primary discovery tool. Its output format:
```
SYMBOL0/SYMBOL1         RESERVE0        RESERVE1        PAIR_ADDRESS
PPI/WCFX                38274.00 PPI    100.00 WCFX     0x621C6A2addfa74a928c0Af5098cF8b3B6E26657f
```
The last column (`0x621C6...`) is the **pair address** — do NOT use it in `dex_swap`.

To get **token addresses** from a pair, call `dex_pool_info`:
```
Pool: PPI/WCFX
  Pair:    0x621C6A2addfa74a928c0Af5098cF8b3B6E26657f   ← pair address (pool)
  Token0:  0x6fFF4EAAA8a1CC93c45D4208C4490a26af38C903   ← PPI token address ✓ use in dex_swap
  Token1:  0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b   ← WCFX token address ✓ use in dex_swap
```

### Correct swap workflow

```
Step 1: dex_list_pairs                        → see available pools
Step 2: dex_pool_info [tokenA=SYMBOL_or_addr] → get exact token0/token1 addresses
Step 3: dex_swap [tokenIn=<TOKEN0_ADDR>, tokenOut=<TOKEN1_ADDR>, amountIn=...]
```

For CFX (native), use the string `"CFX"` — the tool wraps/unwraps via WETH9 automatically:
```
dex_swap [tokenIn="CFX", tokenOut=0x6fFF4EAAA8a1CC93c45D4208C4490a26af38C903, amountIn=100]
```

### Tool quick-reference

| Tool | Key inputs | Notes |
|------|-----------|-------|
| `dex_status` | — | Shows manifest addresses and live pair count |
| `dex_deploy` | `accountIndex` | Run once; deploys Factory → WETH9 → Router02 |
| `dex_seed_from_gecko` | `tokenCount` (1–20) | Mirrors mainnet tokens, seeds TOKEN/WCFX pools |
| `dex_list_pairs` | — | Returns pair table; last column = pair address, NOT token address |
| `dex_pool_info` | `pairAddress` OR `tokenA`+`tokenB` | Returns Token0/Token1 addresses and reserves |
| `dex_swap` | `tokenIn`, `tokenOut`, `amountIn` | **Token addresses or "CFX"/"WCFX" — NEVER pair address** |
| `dex_create_token` | `name`, `symbol` | Deploys a new ERC-20; returns its token address |
| `dex_create_pair` | `tokenA`, `tokenB`, `amountA`, `amountB` | Creates pool + adds initial liquidity |
| `dex_add_liquidity` | `tokenA`, `tokenB`, `amountA`, `amountB` | Add to existing pool |
| `dex_remove_liquidity` | `tokenA`, `lpAmount` | Burns LP tokens, returns underlying |
| `dex_simulation_start` | `tickIntervalMs` | Starts auto price simulation |
| `dex_simulation_step` | — | Single manual price tick |
| `dex_simulation_stop` | — | Halts auto simulation |
| `dex_simulation_reset` | — | Reverts EVM to post-seed snapshot |

### Common mistakes to avoid

1. **Passing a pair address as `tokenIn`/`tokenOut`** — pair contracts are not ERC-20 tokens.  
   Fix: call `dex_pool_info` first to extract Token0/Token1 addresses.

2. **Calling `dex_pool_info` with a token address as `pairAddress`** — use `tokenA` parameter instead.  
   Example: `dex_pool_info [tokenA=0x6fFF..., tokenB=WCFX]` (tokenB defaults to WCFX if omitted).

3. **Assuming token order in a pair** — Uniswap V2 sorts token addresses; token0 < token1 by address.  
   Always use `dex_pool_info` to confirm which address is token0 and which is token1 before swapping.

4. **Using `dex_swap` before `dex_deploy`** — run setup order: `dex_deploy` → `dex_seed_from_gecko` → then swap.

---

## 1 · Network Configuration

| Network | Chain | RPC URL | Chain ID | Block Explorer | ConfluxScan API |
|---------|-------|---------|----------|----------------|-----------------|
| **Mainnet** | eSpace | `https://evm.confluxrpc.com` | 1030 | https://evm.confluxscan.io | https://evmapi.confluxscan.org |
| **Testnet** | eSpace | `https://evmtestnet.confluxrpc.com` | 71 | https://evmtestnet.confluxscan.io | https://evmapi-testnet.confluxscan.org |
| **Mainnet** | Core | `https://main.confluxrpc.com` | 1029 | https://confluxscan.io | — |
| **Testnet** | Core | `https://test.confluxrpc.com` | 1 | https://testnet.confluxscan.io | — |
| **Local** | eSpace | `http://127.0.0.1:8545` | 2030 | — | — |
| **Local** | Core | `http://127.0.0.1:12537` | 2029 | — | — |

**Address formats:**
- **eSpace:** Ethereum-style `0x` hex (42 chars). Same as Ethereum.
- **Core Space:** CIP-37 base32, e.g. `cfx:aatktb2te25ub7dmyag3p8bbdgr31vrbeackztm2rj` (network prefix + base32).

---

## 2 · Public Network Deployment (testnet / mainnet)

> **Local deployment?** Use the devkit MCP tools instead: `conflux_bootstrap_deploy`, `cfxdevkit_compile_and_deploy`, or `blockchain_espace_deploy_contract`.

### Hardhat

```js
// hardhat.config.js
require("@nomicfoundation/hardhat-toolbox");
require("hardhat-conflux-verify");     // optional: contract verification

module.exports = {
  solidity: "0.8.28",
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

### Foundry

```bash
# Deploy
forge create src/MyContract.sol:MyContract \
  --rpc-url https://evmtestnet.confluxrpc.com \
  --private-key $PRIVATE_KEY \
  --gas-estimate-multiplier 200

# Verify (ConfluxScan uses Etherscan-compatible API)
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
4. After deployment, verify on ConfluxScan manually or via API

### Gotchas

- Foundry `--gas-estimate-multiplier 200` — Conflux gas estimation can under-report.
- Always use `evmVersion: "paris"` (or earlier). Shanghai introduces PUSH0 which Conflux does not support.
- `forge verify-contract --chain-id` must match the deployed network.
- Hardhat verification requires `hardhat-conflux-verify` plugin (not vanilla etherscan plugin).

---

## 3 · App Integration

### ethers.js

```js
import { ethers } from "ethers";
const provider = new ethers.JsonRpcProvider("https://evmtestnet.confluxrpc.com");
const balance = await provider.getBalance("0xADDRESS");
```

### viem

```js
import { defineChain } from "viem";

export const confluxESpaceTestnet = defineChain({
  id: 71,
  name: "Conflux eSpace Testnet",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmtestnet.confluxrpc.com"] } },
  blockExplorers: { default: { name: "ConfluxScan", url: "https://evmtestnet.confluxscan.io" } },
});

export const confluxESpace = defineChain({
  id: 1030,
  name: "Conflux eSpace",
  nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
  rpcUrls: { default: { http: ["https://evm.confluxrpc.com"] } },
  blockExplorers: { default: { name: "ConfluxScan", url: "https://evm.confluxscan.io" } },
});
```

### MetaMask Network Config

| Field | Testnet | Mainnet |
|-------|---------|---------|
| Network Name | Conflux eSpace Testnet | Conflux eSpace |
| RPC URL | `https://evmtestnet.confluxrpc.com` | `https://evm.confluxrpc.com` |
| Chain ID | 71 | 1030 |
| Currency Symbol | CFX | CFX |
| Block Explorer | `https://evmtestnet.confluxscan.io` | `https://evm.confluxscan.io` |

### Scaffold Conflux

Scaffold-ETH-2 fork for Conflux: https://github.com/conflux-fans/conflux-scaffold  
Quickstart: `npx create-eth@latest -e conflux-fans/conflux-scaffold`

### Testnet Faucet

https://efaucet.confluxnetwork.org — get testnet CFX for eSpace.

### Cross-Space Bridge

Transfer CFX between Core Space and eSpace: https://confluxhub.io/espace-bridge/cross-space

---

## 4 · Official Documentation

### Spaces Overview
| Topic | URL |
|-------|-----|
| Spaces overview | https://doc.confluxnetwork.org/docs/general/conflux-basics/spaces |
| eSpace overview | https://doc.confluxnetwork.org/docs/espace/Overview |
| Core Space overview | https://doc.confluxnetwork.org/docs/core/Overview |

### eSpace (EVM-Compatible)
| Topic | URL |
|-------|-----|
| Developer quickstart | https://doc.confluxnetwork.org/docs/espace/DeveloperQuickstart |
| Gas & fees | https://doc.confluxnetwork.org/docs/espace/build/evm-compatibility |
| js-conflux-sdk | https://doc.confluxnetwork.org/docs/espace/build/sdks |
| Deploy with Hardhat/Foundry | https://doc.confluxnetwork.org/docs/espace/tutorials/deployContract/hardhatAndFoundry |
| Deploy with Remix | https://doc.confluxnetwork.org/docs/espace/tutorials/deployContract/remix |
| Deploy with Brownie | https://doc.confluxnetwork.org/docs/espace/tutorials/deployContract/brownie |
| Verify contracts | https://doc.confluxnetwork.org/docs/espace/tutorials/VerifyContracts |
| Scaffold Conflux | https://doc.confluxnetwork.org/docs/espace/tutorials/scaffoldCfx/scaffold |
| RPC providers | https://doc.confluxnetwork.org/docs/espace/build/infrastructure/RPC-Provider |

### Core Space
| Topic | URL |
|-------|-----|
| Storage collateral (sponsor) | https://doc.confluxnetwork.org/docs/core/core-space-basics/storage |
| Sponsor mechanism | https://doc.confluxnetwork.org/docs/core/core-space-basics/sponsor-mechanism |
| Internal contracts | https://doc.confluxnetwork.org/docs/core/core-space-basics/internal-contracts |
| Base32 addresses | https://doc.confluxnetwork.org/docs/core/core-space-basics/addresses |
| Core Space RPC | https://doc.confluxnetwork.org/docs/core/conflux_rpcs |
| Core Space JSON-RPC reference | https://doc.confluxnetwork.org/docs/core/build/json-rpc/ |

### General
| Topic | URL |
|-------|-----|
| TreeGraph consensus | https://doc.confluxnetwork.org/docs/general/conflux-basics/consensus-mechanisms/proof-of-work/tree-graph |
| PoW + PoS hybrid | https://doc.confluxnetwork.org/docs/general/conflux-basics/consensus-mechanisms/proof-of-stake/pos_overview |
| Tokenomics (CFX) | https://doc.confluxnetwork.org/docs/general/conflux-basics/economics |
| CIPs repository | https://github.com/Conflux-Chain/CIPs |
| Transfer across spaces | https://doc.confluxnetwork.org/docs/general/tutorials/transferring-funds/transfer-funds-across-spaces |
| Research papers | https://doc.confluxnetwork.org/docs/general/conflux-basics/additional-resources/papers.md |
| Protocol specification | https://confluxnetwork.org/files/Conflux_Protocol_Specification.pdf |
| Grants | https://doc.confluxnetwork.org/docs/general/build/grants |

---

## 5 · Read-Only Chain Queries (public networks)

> **Local queries?** Use the devkit MCP tools instead: `blockchain_espace_get_balance`, `blockchain_espace_get_block_number`, `blockchain_espace_call_contract`, etc.

### Using `cast` (Foundry)

```bash
# Block number
cast block-number --rpc-url https://evmtestnet.confluxrpc.com

# Balance (CFX)
cast balance 0xADDRESS --ether --rpc-url https://evmtestnet.confluxrpc.com

# Transaction receipt
cast receipt 0xTXHASH --rpc-url https://evmtestnet.confluxrpc.com

# Nonce (compare latest vs pending for stuck tx analysis)
cast nonce 0xADDRESS --rpc-url https://evmtestnet.confluxrpc.com
cast nonce 0xADDRESS --block pending --rpc-url https://evmtestnet.confluxrpc.com

# Contract read (ERC-20 balanceOf)
cast call 0xTOKEN "balanceOf(address)(uint256)" 0xADDRESS --rpc-url https://evmtestnet.confluxrpc.com

# Gas price, chain ID, contract code
cast gas-price --rpc-url https://evmtestnet.confluxrpc.com
cast chain-id --rpc-url https://evmtestnet.confluxrpc.com
cast code 0xCONTRACT --rpc-url https://evmtestnet.confluxrpc.com
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

# Transaction receipt
curl -s -X POST https://evmtestnet.confluxrpc.com \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getTransactionReceipt","params":["0xTXHASH"],"id":1}'
```

### Event Logs

**Always use a narrow block range and contract address** — full-range queries hit rate limits.

```bash
cast logs 0xCONTRACT --from-block N --to-block N+1000 \
  "Transfer(address,address,uint256)" --rpc-url https://evmtestnet.confluxrpc.com
```

---

## 6 · ConfluxScan API

Etherscan-compatible REST API for eSpace.

| Base URL | Network |
|----------|---------|
| `https://evmapi.confluxscan.org` | Mainnet |
| `https://evmapi-testnet.confluxscan.org` | Testnet |

**Swagger / OpenAPI:** https://evmapi.confluxscan.org/doc

### Endpoints

| Use Case | Module | Action | Key Params |
|----------|--------|--------|------------|
| Contract ABI | `contract` | `getabi` | `address` |
| Contract source | `contract` | `getsourcecode` | `address` |
| Account txs | `account` | `txlist` | `address`, `page`, `offset`, `sort` |
| Token transfers | `account` | `tokentx` | `address`, `page`, `offset`, `sort` |

```bash
# Contract ABI (testnet)
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
1. Fetch receipt: `cast receipt 0xTXHASH --rpc-url <RPC>`
2. Check `status`: `0x0` = reverted, `0x1` = success
3. Look for `txExecErrorMsg` in the receipt for revert reason

### Stuck / pending tx
1. Compare nonces: `cast nonce ADDR` (latest) vs `cast nonce ADDR --block pending`
2. If pending > latest → txs are queued; earliest nonce must confirm or be replaced

### Transaction lifecycle (Conflux eSpace)
```
Pending → Mined (in block) → Executed (~5 epochs) → Confirmed (~50 epochs) → Finalized (PoS, ~4-6 min)
```
Receipt may be `null` until the tx is executed. See: https://doc.confluxnetwork.org/docs/core/core-space-basics/transactions/lifecycle
