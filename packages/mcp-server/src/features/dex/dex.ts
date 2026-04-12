/**
 * dex.ts — Uniswap V2 DEX deployment and management tools
 *
 * Deploys a full Uniswap V2 stack (Factory → WETH9 → Router02) to the local
 * Conflux eSpace node using pre-compiled artifacts from packages/contracts/artifacts/.
 *
 * Deployment state is stored in-memory by the project-example DEX service.
 * contract addresses are also registered in the devkit contract registry.
 *
 * MCP tools exposed:
 *   dex_status           — Check if V2 is deployed and read on-chain pool count.
 *   dex_deploy           — Deploy Factory → WETH9 → Router02.
 *   dex_seed_from_gecko  — Fetch GT feed, mirror tokens, seed pools.
 *   dex_simulation_start — Start continuous price simulation.
 *   dex_simulation_step  — Manual single tick.
 *   dex_simulation_stop  — Stop continuous simulation.
 *   dex_simulation_reset — Revert to post-seed state.
 */

import { artifacts, _init_code_hash, type ContractArtifact } from '@cfxdevkit/dex-contracts';
import {
  getAccount,
  resolvePrivateKey,
} from '../../keystore.js';
import {
  saveContract,
} from '../../contracts.js';
import {
  readTrackedDexContracts,
  findTrackedContractByName,
  findTrackedContractByRealAddress,
  buildManifestFromTrackedContracts,
  buildTranslationTableFromTrackedContracts,
} from './dex-registry.js';
import { fetchWcfxPrice } from './dex-pricing.js';
import { ensureEspaceFunding } from './dex-funding.js';
import { createSimulationEngine } from './dex-simulation-bootstrap.js';
import { createSimulationRuntime } from './dex-simulation-runtime.js';
import { createDexToolHandler } from './dex-tool-handler.js';
import { dexToolDefinitions } from './dex-tool-definitions.js';
import { createDexAbiAccessors } from './dex-abi.js';
import { createDexStateStore } from './dex-state-store.js';
import { deployV2StackCore, verifyDeploymentCore } from './dex-deploy-core.js';
import type {
  StableEntry,
  V2Manifest,
} from './dex-types.js';

export { dexToolDefinitions };

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_ESPACE_RPC = 'http://localhost:8545';
const DEFAULT_ESPACE_CHAIN_ID = 2030;
const MAINNET_CHAIN_ID = 1030;
const WEI_PER_CFX = 10n ** 18n;
const TOKEN_PAIR_GAS_BUFFER_WEI = 15n * WEI_PER_CFX;
const STABLE_DEPLOY_GAS_BUFFER_WEI = 80n * WEI_PER_CFX;
const STABLE_PAIR_GAS_BUFFER_WEI = 20n * WEI_PER_CFX;
const STABLE_CROSS_PAIR_GAS_BUFFER_WEI = 15n * WEI_PER_CFX;

/** URL of the DEX UI service — receives manifest/table updates and state resets. */
const DEVKIT_URL = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748';


// ── Types ─────────────────────────────────────────────────────────────────────

export type { StableEntry, V2Manifest };

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadArtifact(name: string): ContractArtifact {
  const art = artifacts[name];
  if (!art) throw new Error(`Artifact "${name}" not found in @cfxdevkit/dex-contracts`);
  return art;
}

const {
  ERC20_ABI,
  PAIR_ABI,
  ROUTER_ABI,
  FACTORY_ABI,
  WETH_ABI,
  MIRROR_ABI,
} = createDexAbiAccessors(loadArtifact);

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Deploy the full Uniswap V2 stack on eSpace.
 * Order: Factory → WETH9 → Router02
 */
export async function deployV2Stack(
  accountIndex: number,
  rpcUrl: string,
  chainId: number,
): Promise<V2Manifest> {
  return deployV2StackCore({
    accountIndex,
    rpcUrl,
    chainId,
    registrySuffix: REGISTRY_SUFFIX,
    initCodeHash: _init_code_hash.computed,
    getAccount,
    resolvePrivateKey,
    loadArtifact,
    saveContract,
    postManifest,
  });
}

/**
 * Verify deployment by reading factory.allPairsLength() on-chain.
 */
export async function verifyDeployment(manifest: V2Manifest): Promise<{ ok: boolean; pairCount: number; error?: string }> {
  return verifyDeploymentCore({ manifest, loadArtifact });
}

// ── Stablecoin definitions ────────────────────────────────────────────────────

/**
 * DEVKIT_NAME_SUFFIX is appended to all locally deployed token names
 * so they are clearly distinguishable from mainnet assets.
 */
const DEVKIT_NAME_SUFFIX = ' (DevKit)';

/**
 * REGISTRY_SUFFIX is appended to contract names in the devkit contract registry.
 * server.ts seedFromDevkit() expects this suffix to identify devkit-deployed contracts.
 */
const REGISTRY_SUFFIX = '__devkit';

const {
  postManifest,
  postTranslationTable,
  readManifest,
  readTranslationTable,
  clearCache,
  resetRemoteState,
} = createDexStateStore({
  devkitUrl: DEVKIT_URL,
  defaultRpcUrl: DEFAULT_ESPACE_RPC,
  defaultChainId: DEFAULT_ESPACE_CHAIN_ID,
  registrySuffix: REGISTRY_SUFFIX,
  readTrackedDexContracts,
  buildManifestFromTrackedContracts,
  buildTranslationTableFromTrackedContracts,
  verifyDeployment,
});

// ── MCP tool definitions ──────────────────────────────────────────────────────

const simulationRuntime = createSimulationRuntime(async (accountIndex, rpcUrl, chainId, configOverrides) => {
  return createSimulationEngine({
    accountIndex,
    rpcUrl,
    chainId,
    configOverrides,
    deps: {
      mainnetChainId: MAINNET_CHAIN_ID,
      loadArtifact,
      pairAbi: PAIR_ABI,
      wethAbi: WETH_ABI,
      mirrorAbi: MIRROR_ABI,
      erc20Abi: ERC20_ABI,
      routerAbi: ROUTER_ABI,
      readManifest,
      readTranslationTable,
    },
  });
});

/**
 * Reset DEX service in-memory state.
 * Called by conflux_node_wipe so local DEX state is always in sync with chain state.
 */
export async function wipeLocalDexState(): Promise<void> {
  clearCache();
  await resetRemoteState();
  simulationRuntime.destroy();
}

const dexToolHandlerCore = createDexToolHandler({
  mainnetChainId: MAINNET_CHAIN_ID,
  registrySuffix: REGISTRY_SUFFIX,
  devkitNameSuffix: DEVKIT_NAME_SUFFIX,
  tokenPairGasBufferWei: TOKEN_PAIR_GAS_BUFFER_WEI,
  stableDeployGasBufferWei: STABLE_DEPLOY_GAS_BUFFER_WEI,
  stablePairGasBufferWei: STABLE_PAIR_GAS_BUFFER_WEI,
  stableCrossPairGasBufferWei: STABLE_CROSS_PAIR_GAS_BUFFER_WEI,
  readManifest,
  verifyDeployment,
  deployV2Stack,
  readTrackedDexContracts,
  fetchWcfxPrice: () => fetchWcfxPrice(DEVKIT_URL),
  getAccount,
  resolvePrivateKey,
  readTranslationTable,
  loadArtifact,
  saveContract,
  findTrackedContractByRealAddress,
  findTrackedContractByName,
  ensureFunding: (params) => ensureEspaceFunding({
    ...params,
    devkitUrl: DEVKIT_URL,
  }),
  postManifest,
  postTranslationTable,
  abis: {
    erc20Abi: ERC20_ABI,
    pairAbi: PAIR_ABI,
    routerAbi: ROUTER_ABI,
    factoryAbi: FACTORY_ABI,
    wethAbi: WETH_ABI,
    mirrorAbi: MIRROR_ABI,
  },
  simulationRuntime: {
    getOrCreateEngine: simulationRuntime.getOrCreateEngine,
    getActiveEngine: simulationRuntime.getActiveEngine,
    getActiveStopFn: simulationRuntime.getActiveStopFn,
    setActiveStopFn: simulationRuntime.setActiveStopFn,
  },
});

// ── MCP tool handler ──────────────────────────────────────────────────────────

export async function dexToolHandler(
  name: string,
  a: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
  const rpcUrl  = (a.rpcUrl  as string | undefined) ?? DEFAULT_ESPACE_RPC;
  const chainId = (a.chainId as number | undefined) ?? DEFAULT_ESPACE_CHAIN_ID;
  return dexToolHandlerCore(name, a, rpcUrl, chainId);
}
