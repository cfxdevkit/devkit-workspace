import { prepareSeedBootstrap } from './dex-seed-bootstrap.js';
import { seedMirrorPools } from './dex-seed-pools.js';
import { runSeedStableAndVaultPhase, buildSeedCompletionText } from './dex-seed-finalize.js';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { EspaceWalletClient } from '@cfxdevkit/core';
import type { TrackedContract } from '../../contracts.js';
import type { TranslationTable } from '@cfxdevkit/shared';
import type { V2Manifest } from './dex-types.js';

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

export async function handleDexSeedFromGecko(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: {
    mainnetChainId: number;
    registrySuffix: string;
    devkitNameSuffix: string;
    tokenPairGasBufferWei: bigint;
    stableDeployGasBufferWei: bigint;
    stablePairGasBufferWei: bigint;
    stableCrossPairGasBufferWei: bigint;
    readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
    readTrackedDexContracts: (chainId: number) => Promise<TrackedContract[]>;
    fetchWcfxPrice: () => Promise<number>;
    getAccount: (index: number) => { evmAddress: string };
    resolvePrivateKey: (index: number, chain: 'espace') => string;
    readTranslationTable: (localWETH?: string, chainId?: number) => Promise<TranslationTable | null>;
    loadArtifact: (name: string) => ContractArtifact;
    erc20Abi: () => unknown[];
    mirrorAbi: () => unknown[];
    saveContract: (input: SaveContractInput) => Promise<unknown>;
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
    verifyDeployment: (manifest: V2Manifest) => Promise<VerifyResult>;
    postManifest: (manifest: V2Manifest) => Promise<void>;
    postTranslationTable: (table: TranslationTable) => Promise<void>;
  };
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;

  const bootstrap = await prepareSeedBootstrap({
    args,
    rpcUrl,
    chainId,
    mainnetChainId: deps.mainnetChainId,
    readManifest: deps.readManifest,
    readTrackedDexContracts: deps.readTrackedDexContracts,
    fetchWcfxPrice: deps.fetchWcfxPrice,
    getAccount: deps.getAccount,
    resolvePrivateKey: deps.resolvePrivateKey,
    readTranslationTable: deps.readTranslationTable,
    loadArtifact: deps.loadArtifact,
  });
  if (!bootstrap.ok) {
    return bootstrap.result;
  }

  const {
    selectedStablecoins,
    selectedPools,
    warnings,
    manifest,
    trackedContracts,
    feed,
    wcfxPriceUsd,
    wallet,
    deployer,
    privateKey,
    fundingLines,
    mirrorTable,
    mirrorArtifact,
    routerArtifact,
  } = bootstrap.data;

  const ensureFunding = (label: string, requiredWei: bigint) => deps.ensureFunding({
    rpcUrl: manifest.rpcUrl,
    chainId: manifest.chainId,
    wallet,
    deployer,
    privateKey,
    requiredWei,
    label,
    fundingLines,
    logPrefix: '[dex_seed]',
  });

  const { lines, seededCount, skippedCount } = await seedMirrorPools({
    feed,
    manifest,
    wcfxPriceUsd,
    wallet,
    deployer,
    fundingLines,
    mirrorTable,
    mirrorArtifact,
    routerArtifact,
    devkitNameSuffix: deps.devkitNameSuffix,
    registrySuffix: deps.registrySuffix,
    tokenPairGasBufferWei: deps.tokenPairGasBufferWei,
    erc20Abi: deps.erc20Abi,
    ensureFunding,
    saveContract: deps.saveContract,
  });

  const { stableLines, vaultLine } = await runSeedStableAndVaultPhase({
    wallet,
    deployer,
    privateKey,
    manifest,
    trackedContracts,
    mirrorTable,
    wcfxPriceUsd,
    selectedStablecoins,
    fundingLines,
    registrySuffix: deps.registrySuffix,
    devkitNameSuffix: deps.devkitNameSuffix,
    stableDeployGasBufferWei: deps.stableDeployGasBufferWei,
    stablePairGasBufferWei: deps.stablePairGasBufferWei,
    stableCrossPairGasBufferWei: deps.stableCrossPairGasBufferWei,
    loadArtifact: deps.loadArtifact,
    mirrorAbi: deps.mirrorAbi,
    erc20Abi: deps.erc20Abi,
    saveContract: deps.saveContract,
    findTrackedContractByRealAddress: deps.findTrackedContractByRealAddress,
    findTrackedContractByName: deps.findTrackedContractByName,
    ensureFunding,
  });

  await deps.postManifest(manifest);

  const verify = await deps.verifyDeployment(manifest);
  console.error(`[dex_seed] Done — ${seededCount} pools seeded, ${verify.ok ? verify.pairCount : '?'} on-chain pairs`);

  await deps.postManifest(manifest);
  await deps.postTranslationTable(mirrorTable.getTranslationTable());

  return {
    text: buildSeedCompletionText({
      wcfxPriceUsd,
      selectedPools,
      feedTokenCount: feed.tokens.length,
      seededCount,
      skippedCount,
      selectedStablecoins,
      verify,
      warnings,
      fundingLines,
      lines,
      stableLines,
      vaultLine,
    }),
  };
}
