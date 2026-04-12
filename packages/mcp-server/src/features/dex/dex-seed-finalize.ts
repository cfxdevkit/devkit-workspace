import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { EspaceWalletClient } from '@cfxdevkit/core';
import type { TokenMirror } from '@cfxdevkit/shared';
import { STABLECOIN_DEFS, deployStablecoins, seedStablecoinPools } from './dex-stables.js';
import type { TrackedContract } from '../../contracts.js';
import type { V2Manifest } from './dex-types.js';

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

export async function runSeedStableAndVaultPhase(params: {
  wallet: EspaceWalletClient;
  deployer: string;
  privateKey: string;
  manifest: V2Manifest;
  trackedContracts: TrackedContract[];
  mirrorTable: TokenMirror;
  wcfxPriceUsd: number;
  selectedStablecoins?: string[];
  fundingLines: string[];
  registrySuffix: string;
  devkitNameSuffix: string;
  stableDeployGasBufferWei: bigint;
  stablePairGasBufferWei: bigint;
  stableCrossPairGasBufferWei: bigint;
  loadArtifact: (name: string) => ContractArtifact;
  mirrorAbi: () => unknown[];
  erc20Abi: () => unknown[];
  saveContract: (input: SaveContractInput) => Promise<unknown>;
  findTrackedContractByRealAddress: (contracts: TrackedContract[], realAddress: string) => TrackedContract | null;
  findTrackedContractByName: (contracts: TrackedContract[], name: string) => TrackedContract | null;
  ensureFunding: (label: string, requiredWei: bigint) => Promise<void>;
}): Promise<{
  stableLines: string[];
  vaultLine: string;
  selectedStablecoins: string[] | undefined;
}> {
  const {
    wallet,
    deployer,
    manifest,
    trackedContracts,
    mirrorTable,
    wcfxPriceUsd,
    selectedStablecoins,
    registrySuffix,
    devkitNameSuffix,
    stableDeployGasBufferWei,
    stablePairGasBufferWei,
    stableCrossPairGasBufferWei,
    loadArtifact,
    mirrorAbi,
    erc20Abi,
    saveContract,
    findTrackedContractByRealAddress,
    findTrackedContractByName,
    ensureFunding,
  } = params;

  console.error('[dex_seed] Step 7/8: Deploying stablecoins…');

  const stableLines: string[] = [];
  let stableDeployErr: string | null = null;
  try {
    const stables = await deployStablecoins({
      wallet,
      deployer,
      chainId: manifest.chainId,
      trackedContracts,
      options: {
        ensureFunding,
        onProgress: (message) => {
          console.error(`[dex_seed]   ${message}`);
          stableLines.push(`  • ${message}`);
        },
      },
      selectedStablecoins,
      registrySuffix,
      devkitNameSuffix,
      stableDeployGasBufferWei,
      loadArtifact,
      mirrorAbi,
      findTrackedContractByRealAddress,
      findTrackedContractByName,
      saveContract,
    });

    manifest.stables = stables;
    manifest.wcfxPriceUsd = wcfxPriceUsd;

    for (const def of STABLECOIN_DEFS) {
      const entry = stables[def.symbol];
      if (entry) {
        mirrorTable.recordMirror(
          { realAddress: def.realAddress, symbol: def.symbol, decimals: def.decimals, iconCached: false },
          entry.address,
        );
      }
    }

    stableLines.push('', 'Stablecoins ready:');
    for (const [sym, entry] of Object.entries(stables)) {
      stableLines.push(`  💲 ${sym.padEnd(6)} → ${entry.address} (${entry.decimals} dec)`);
    }

    const poolLines = await seedStablecoinPools({
      wallet,
      deployer,
      manifest,
      stables,
      wcfxPriceUsd,
      options: {
        ensureFunding,
        onProgress: (message) => {
          console.error(`[dex_seed]   ${message}`);
          stableLines.push(`  • ${message}`);
        },
      },
      selectedStablecoins,
      stablePairGasBufferWei,
      stableCrossPairGasBufferWei,
      loadArtifact,
      erc20Abi,
      mirrorAbi,
    });
    stableLines.push('', 'Stablecoin pools:');
    stableLines.push(...poolLines);
  } catch (err) {
    stableDeployErr = String(err).split('\n')[0];
    stableLines.push(`\n❌  Stablecoin deployment failed: ${stableDeployErr}`);
  }

  console.error('[dex_seed] Step 8/8: Deploying PayableVault…');

  let vaultLine = '';
  try {
    const existingVault = findTrackedContractByName(trackedContracts, `PayableVault${registrySuffix}`);
    if (existingVault) {
      vaultLine = `\n🏦 PayableVault reused: ${existingVault.address}\n   Accepts any ERC-20 deposit(token, amount) + native CFX via depositNative()`;
    } else {
      const vaultArtifact = loadArtifact('PayableVault');
      const vaultAddress = await wallet.deployContract(
        vaultArtifact.abi,
        vaultArtifact.bytecode,
        [],
      );
      await saveContract({
        name: `PayableVault${registrySuffix}`,
        address: vaultAddress,
        chain: 'evm',
        chainId: manifest.chainId,
        deployer,
        deployedAt: new Date().toISOString(),
        abi: vaultArtifact.abi,
      });
      vaultLine = `\n🏦 PayableVault deployed: ${vaultAddress}\n   Accepts any ERC-20 deposit(token, amount) + native CFX via depositNative()`;
    }
  } catch (err) {
    vaultLine = `\n⚠  PayableVault deploy failed: ${String(err).split('\n')[0]}`;
  }

  return {
    stableLines,
    vaultLine,
    selectedStablecoins,
  };
}

export function buildSeedCompletionText(params: {
  wcfxPriceUsd: number;
  selectedPools: Array<{ address: string; label: string }>;
  feedTokenCount: number;
  seededCount: number;
  skippedCount: number;
  selectedStablecoins?: string[];
  verify: VerifyResult;
  warnings: string[];
  fundingLines: string[];
  lines: string[];
  stableLines: string[];
  vaultLine: string;
}): string {
  const {
    wcfxPriceUsd,
    selectedPools,
    feedTokenCount,
    seededCount,
    skippedCount,
    selectedStablecoins,
    verify,
    warnings,
    fundingLines,
    lines,
    stableLines,
    vaultLine,
  } = params;

  return [
    '✅  dex_seed_from_gecko complete',
    `    WCFX price used:  $${wcfxPriceUsd.toPrecision(4)}`,
    `    Source pools:     ${selectedPools.length}`,
    `    Tokens from feed: ${feedTokenCount}`,
    `    Seeded:           ${seededCount}`,
    `    Skipped (error):  ${skippedCount}`,
    `    Stablecoins:      ${(selectedStablecoins?.length ?? STABLECOIN_DEFS.length)} (${(selectedStablecoins ?? STABLECOIN_DEFS.map((def) => def.symbol)).join(', ')})`,
    `    On-chain pairs:   ${verify.ok ? verify.pairCount : 'RPC error'}`,
    '',
    ...selectedPools.map((pool) => `  📥 Source pool ${pool.label.padEnd(16)} ${pool.address}`),
    ...(warnings.length ? ['', ...warnings.map((warning) => `  ⚠  ${warning}`)] : []),
    '',
    ...(fundingLines.length ? [...fundingLines, ''] : []),
    ...lines,
    ...stableLines,
    vaultLine,
    '',
    'Translation table saved to DEX service.',
    'Run dex_status to confirm pair count.',
  ].join('\n');
}
