import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import { EspaceWalletClient } from '@cfxdevkit/core';
import {
  refreshSelectedTokenSourcesCache,
  TokenMirror,
  type TokenSourceSelection,
  type TranslationTable,
} from '@cfxdevkit/shared';
import {
  loadKnownTokenCatalog,
  loadPoolImportPresets,
  resolveSelectedPoolAddresses,
  buildTokenSourceSelections,
} from './dex-token-catalog.js';
import { refreshSelectedSourcesViaBackend } from './dex-backend-client.js';
import type { V2Manifest } from './dex-types.js';
import type { TrackedContract } from '../../contracts.js';

type ToolResult = { text: string; isError?: boolean };

type SeedBootstrapParams = {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  mainnetChainId: number;
  readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
  readTrackedDexContracts: (chainId: number) => Promise<TrackedContract[]>;
  fetchWcfxPrice: () => Promise<number>;
  getAccount: (index: number) => { evmAddress: string };
  resolvePrivateKey: (index: number, chain: 'espace') => string;
  readTranslationTable: (localWETH?: string, chainId?: number) => Promise<TranslationTable | null>;
  loadArtifact: (name: string) => ContractArtifact;
};

type SeedBootstrapSuccess = {
  accountIndex: number;
  selectedStablecoins: string[] | undefined;
  selectedPools: Array<{ address: string; label: string }>;
  warnings: string[];
  manifest: V2Manifest;
  trackedContracts: TrackedContract[];
  feed: Awaited<ReturnType<typeof refreshSelectedTokenSourcesCache>>;
  wcfxPriceUsd: number;
  wallet: EspaceWalletClient;
  deployer: string;
  privateKey: string;
  fundingLines: string[];
  mirrorTable: TokenMirror;
  mirrorArtifact: ContractArtifact;
  routerArtifact: ContractArtifact;
};

export async function prepareSeedBootstrap(
  params: SeedBootstrapParams,
): Promise<{ ok: true; data: SeedBootstrapSuccess } | { ok: false; result: ToolResult }> {
  const {
    args,
    rpcUrl,
    chainId,
    mainnetChainId,
    readManifest,
    readTrackedDexContracts,
    fetchWcfxPrice,
    getAccount,
    resolvePrivateKey,
    readTranslationTable,
    loadArtifact,
  } = params;

  const accountIndex = (args.accountIndex as number | undefined) ?? 0;
  const forceRefresh = (args.forceRefresh as boolean | undefined) ?? false;
  const selectedStablecoins = Array.isArray(args.selectedStablecoins)
    ? (args.selectedStablecoins as string[])
    : undefined;

  const catalog = loadKnownTokenCatalog();
  const presets = loadPoolImportPresets();
  const selectedPoolAddresses = resolveSelectedPoolAddresses(args.selectedPoolAddresses, presets, catalog);

  if (selectedPoolAddresses.length === 0) {
    return {
      ok: false,
      result: {
        text: '❌  No source pools are available. Regenerate dex-ui/public/known-tokens.json or pass selectedPoolAddresses explicitly.',
        isError: true,
      },
    };
  }

  const { selections: tokenSelections, selectedPools, warnings } = buildTokenSourceSelections(catalog, selectedPoolAddresses);
  if (tokenSelections.length === 0) {
    return {
      ok: false,
      result: {
        text: [
          '❌  Selected pools do not resolve to any importable non-stable tokens.',
          `    Selected pools: ${selectedPoolAddresses.length}`,
          ...warnings.map((warning) => `    ${warning}`),
        ].join('\n'),
        isError: true,
      },
    };
  }

  const manifest = await readManifest(rpcUrl, chainId);
  if (!manifest) {
    return {
      ok: false,
      result: {
        text: '❌  v2-manifest.json not found. Run dex_deploy first.',
        isError: true,
      },
    };
  }
  const trackedContracts = await readTrackedDexContracts(manifest.chainId);

  console.error('[dex_seed] Step 1/8: Fetching selected GeckoTerminal source pools…');
  const backendFeed = await refreshSelectedSourcesViaBackend({
    chainId: mainnetChainId,
    tokenSelections: tokenSelections as TokenSourceSelection[],
    forceRefresh,
  });

  const feed = backendFeed ?? await refreshSelectedTokenSourcesCache(
    mainnetChainId,
    tokenSelections as TokenSourceSelection[],
    {
      skipStables: true,
      historyHours: 1,
      includeIcons: false,
    },
    forceRefresh ? 0 : 30 * 60 * 1000,
  );

  if (feed.tokens.length === 0) {
    return {
      ok: false,
      result: {
        text: '❌  No tokens returned from the selected GeckoTerminal source pools.',
        isError: true,
      },
    };
  }
  console.error(`[dex_seed]   → ${feed.tokens.length} token feeds fetched from ${selectedPools.length} selected pools`);

  const wcfxPriceUsd = (feed.wcfxPriceUsd != null && feed.wcfxPriceUsd > 0)
    ? feed.wcfxPriceUsd
    : await fetchWcfxPrice();
  console.error(`[dex_seed]   → WCFX price: $${wcfxPriceUsd.toPrecision(4)}`);

  const account = getAccount(accountIndex);
  const privateKey = resolvePrivateKey(accountIndex, 'espace');
  const wallet = new EspaceWalletClient({
    rpcUrl: manifest.rpcUrl,
    chainId: manifest.chainId,
    privateKey,
  });
  const deployer = account.evmAddress;

  const fundingLines: string[] = [];
  fundingLines.push('  ℹ️ Progressive funding enabled: mining/bridging in chunks before each liquidity operation.');

  const mirrorTable = new TokenMirror({
    chainId: manifest.chainId,
    localWETH: manifest.contracts.weth9,
    initialTable: await readTranslationTable(manifest.contracts.weth9, manifest.chainId) ?? undefined,
  });

  const mirrorArtifact = loadArtifact('MirrorERC20');
  const routerArtifact = loadArtifact('UniswapV2Router02');

  return {
    ok: true,
    data: {
      accountIndex,
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
    },
  };
}
