import {
  handleSimulationStep,
  handleSimulationStart,
  handleSimulationStop,
  handleSimulationReset,
} from './dex-simulation-tools.js';
import { handleCreateToken } from './dex-token-tools.js';
import {
  handleCreatePair,
  handleAddLiquidity,
  handleRemoveLiquidity,
} from './dex-liquidity-tools.js';
import { handleSwap } from './dex-swap-tools.js';
import {
  handlePoolInfo,
  handleListPairs,
} from './dex-pool-tools.js';
import {
  handleDexStatus,
  handleDexDeploy,
} from './dex-admin-tools.js';
import { handleDexSeedFromGecko } from './dex-seed-tools.js';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { EspaceWalletClient } from '@cfxdevkit/core';
import type { FeedCache, SimulationEngine, TranslationTable } from '@cfxdevkit/shared';
import type { TrackedContract } from '../../contracts.js';
import type { V2Manifest } from './dex-types.js';

type ToolArgs = Record<string, unknown>;
type ToolResult = { text: string; isError?: boolean };

type VerifyResult = { ok: boolean; pairCount: number; error?: string };

type SaveContractInput = {
  name: string;
  address: string;
  chain: 'evm' | 'core';
  chainId: number;
  deployer: string;
  deployedAt: string;
  abi: unknown[];
  metadata?: Record<string, unknown>;
};

type SimulationConfigOverrides = {
  minDeviationBps?: number;
  tickIntervalMs?: number;
};

type DexToolHandlerDeps = {
  mainnetChainId: number;
  registrySuffix: string;
  devkitNameSuffix: string;
  tokenPairGasBufferWei: bigint;
  stableDeployGasBufferWei: bigint;
  stablePairGasBufferWei: bigint;
  stableCrossPairGasBufferWei: bigint;
  readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
  verifyDeployment: (manifest: V2Manifest) => Promise<VerifyResult>;
  deployV2Stack: (accountIndex: number, rpcUrl: string, chainId: number) => Promise<V2Manifest>;
  readTrackedDexContracts: (chainId: number) => Promise<TrackedContract[]>;
  fetchWcfxPrice: () => Promise<number>;
  getAccount: (index: number) => { evmAddress: string };
  resolvePrivateKey: (index: number, chain: 'espace' | 'core') => string;
  readTranslationTable: (localWETH?: string, chainId?: number) => Promise<TranslationTable | null>;
  loadArtifact: (name: string) => ContractArtifact;
  saveContract: (contract: SaveContractInput) => Promise<TrackedContract>;
  findTrackedContractByRealAddress: (contracts: TrackedContract[], realAddress: string) => TrackedContract | null;
  findTrackedContractByName: (contracts: TrackedContract[], name: string) => TrackedContract | null;
  ensureFunding: (params: {
    rpcUrl: string;
    chainId: number;
    wallet?: EspaceWalletClient;
    deployer: string;
    privateKey: string;
    requiredWei: bigint;
    label: string;
    fundingLines?: string[];
    logPrefix?: string;
  }) => Promise<void>;
  postManifest: (manifest: V2Manifest) => Promise<void>;
  postTranslationTable: (table: TranslationTable) => Promise<void>;
  abis: {
    erc20Abi: () => unknown[];
    pairAbi: () => unknown[];
    routerAbi: () => unknown[];
    factoryAbi: () => unknown[];
    wethAbi: () => unknown[];
    mirrorAbi: () => unknown[];
  };
  simulationRuntime: {
    getOrCreateEngine: (
      accountIndex: number,
      rpcUrl: string,
      chainId: number,
      configOverrides?: SimulationConfigOverrides,
    ) => Promise<{ engine: SimulationEngine; feedCache: FeedCache }>;
    getActiveEngine: () => SimulationEngine | null;
    getActiveStopFn: () => (() => void) | null;
    setActiveStopFn: (stopFn: (() => void) | null) => void;
  };
};

export function createDexToolHandler(deps: DexToolHandlerDeps) {
  return async function dexToolHandlerCore(
    name: string,
    a: ToolArgs,
    rpcUrl: string,
    chainId: number,
  ): Promise<ToolResult> {
    switch (name) {
      case 'dex_status': {
        return handleDexStatus({
          rpcUrl,
          chainId,
          deps: {
            readManifest: deps.readManifest,
            verifyDeployment: deps.verifyDeployment,
            deployV2Stack: deps.deployV2Stack,
            getActiveEngine: deps.simulationRuntime.getActiveEngine,
          },
        });
      }

      case 'dex_deploy': {
        return handleDexDeploy({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            readManifest: deps.readManifest,
            verifyDeployment: deps.verifyDeployment,
            deployV2Stack: deps.deployV2Stack,
            getActiveEngine: deps.simulationRuntime.getActiveEngine,
          },
        });
      }

      case 'dex_seed_from_gecko': {
        return handleDexSeedFromGecko({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            mainnetChainId: deps.mainnetChainId,
            registrySuffix: deps.registrySuffix,
            devkitNameSuffix: deps.devkitNameSuffix,
            tokenPairGasBufferWei: deps.tokenPairGasBufferWei,
            stableDeployGasBufferWei: deps.stableDeployGasBufferWei,
            stablePairGasBufferWei: deps.stablePairGasBufferWei,
            stableCrossPairGasBufferWei: deps.stableCrossPairGasBufferWei,
            readManifest: deps.readManifest,
            readTrackedDexContracts: deps.readTrackedDexContracts,
            fetchWcfxPrice: deps.fetchWcfxPrice,
            getAccount: deps.getAccount,
            resolvePrivateKey: deps.resolvePrivateKey,
            readTranslationTable: deps.readTranslationTable,
            loadArtifact: deps.loadArtifact,
            erc20Abi: deps.abis.erc20Abi,
            mirrorAbi: deps.abis.mirrorAbi,
            saveContract: deps.saveContract,
            findTrackedContractByRealAddress: deps.findTrackedContractByRealAddress,
            findTrackedContractByName: deps.findTrackedContractByName,
            ensureFunding: deps.ensureFunding,
            verifyDeployment: deps.verifyDeployment,
            postManifest: deps.postManifest,
            postTranslationTable: deps.postTranslationTable,
          },
        });
      }

      case 'dex_simulation_step': {
        return handleSimulationStep({
          args: a,
          rpcUrl,
          chainId,
          getOrCreateEngine: deps.simulationRuntime.getOrCreateEngine,
        });
      }

      case 'dex_simulation_start': {
        return handleSimulationStart({
          args: a,
          rpcUrl,
          chainId,
          getOrCreateEngine: deps.simulationRuntime.getOrCreateEngine,
          state: {
            getActiveEngine: deps.simulationRuntime.getActiveEngine,
            getActiveStopFn: deps.simulationRuntime.getActiveStopFn,
            setActiveStopFn: deps.simulationRuntime.setActiveStopFn,
          },
        });
      }

      case 'dex_simulation_stop': {
        return handleSimulationStop({
          state: {
            getActiveEngine: deps.simulationRuntime.getActiveEngine,
            getActiveStopFn: deps.simulationRuntime.getActiveStopFn,
            setActiveStopFn: deps.simulationRuntime.setActiveStopFn,
          },
        });
      }

      case 'dex_simulation_reset': {
        return handleSimulationReset({
          state: {
            getActiveEngine: deps.simulationRuntime.getActiveEngine,
            getActiveStopFn: deps.simulationRuntime.getActiveStopFn,
            setActiveStopFn: deps.simulationRuntime.setActiveStopFn,
          },
        });
      }

      case 'dex_create_token': {
        return handleCreateToken({
          args: a,
          rpcUrl,
          chainId,
          registrySuffix: deps.registrySuffix,
          devkitNameSuffix: deps.devkitNameSuffix,
          getAccount: deps.getAccount,
          resolvePrivateKey: deps.resolvePrivateKey,
          readTrackedDexContracts: deps.readTrackedDexContracts,
          findTrackedContractByName: deps.findTrackedContractByName,
          saveContract: deps.saveContract,
          loadArtifact: deps.loadArtifact,
          mirrorAbi: deps.abis.mirrorAbi,
        });
      }

      case 'dex_create_pair': {
        return handleCreatePair({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            getAccount: deps.getAccount,
            resolvePrivateKey: deps.resolvePrivateKey,
            readManifest: deps.readManifest,
            loadArtifact: deps.loadArtifact,
            erc20Abi: deps.abis.erc20Abi,
            factoryAbi: deps.abis.factoryAbi,
            pairAbi: deps.abis.pairAbi,
          },
        });
      }

      case 'dex_add_liquidity': {
        return handleAddLiquidity({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            getAccount: deps.getAccount,
            resolvePrivateKey: deps.resolvePrivateKey,
            readManifest: deps.readManifest,
            loadArtifact: deps.loadArtifact,
            erc20Abi: deps.abis.erc20Abi,
            factoryAbi: deps.abis.factoryAbi,
            pairAbi: deps.abis.pairAbi,
          },
        });
      }

      case 'dex_remove_liquidity': {
        return handleRemoveLiquidity({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            getAccount: deps.getAccount,
            resolvePrivateKey: deps.resolvePrivateKey,
            readManifest: deps.readManifest,
            loadArtifact: deps.loadArtifact,
            erc20Abi: deps.abis.erc20Abi,
            factoryAbi: deps.abis.factoryAbi,
            pairAbi: deps.abis.pairAbi,
          },
        });
      }

      case 'dex_swap': {
        return handleSwap({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            getAccount: deps.getAccount,
            resolvePrivateKey: deps.resolvePrivateKey,
            readManifest: deps.readManifest,
            loadArtifact: deps.loadArtifact,
            erc20Abi: deps.abis.erc20Abi,
          },
        });
      }

      case 'dex_pool_info': {
        return handlePoolInfo({
          args: a,
          rpcUrl,
          chainId,
          deps: {
            readManifest: deps.readManifest,
            erc20Abi: deps.abis.erc20Abi,
            pairAbi: deps.abis.pairAbi,
            factoryAbi: deps.abis.factoryAbi,
          },
        });
      }

      case 'dex_list_pairs': {
        return handleListPairs({
          rpcUrl,
          chainId,
          deps: {
            readManifest: deps.readManifest,
            erc20Abi: deps.abis.erc20Abi,
            pairAbi: deps.abis.pairAbi,
            factoryAbi: deps.abis.factoryAbi,
          },
        });
      }

      default:
        return { text: `Unknown dex tool: ${name}`, isError: true };
    }
  };
}
