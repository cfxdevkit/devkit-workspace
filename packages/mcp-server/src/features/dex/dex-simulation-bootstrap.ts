import {
  EspaceWalletClient,
  EspaceTestClient,
  EspaceClient,
} from '@cfxdevkit/core';
import {
  loadCache,
  SimulationEngine,
  type ChainAdapter,
  type FeedCache,
  type TranslationTable,
} from '@cfxdevkit/shared';
import {
  getAccount,
  resolvePrivateKey,
} from '../../keystore.js';
import type { V2Manifest } from './dex-types.js';

export type SimulationBootstrapDeps = {
  mainnetChainId: number;
  loadArtifact: (name: string) => { abi: unknown[] };
  pairAbi: () => unknown[];
  wethAbi: () => unknown[];
  mirrorAbi: () => unknown[];
  erc20Abi: () => unknown[];
  routerAbi: () => unknown[];
  readManifest: (rpcUrl: string, chainId: number) => Promise<V2Manifest | null>;
  readTranslationTable: (localWETH: string, chainId: number) => Promise<TranslationTable | null>;
};

function buildChainAdapter(
  testClient: EspaceTestClient,
  wallet: EspaceWalletClient,
  deployer: string,
  wethAddress: string,
  deps: Pick<SimulationBootstrapDeps, 'pairAbi' | 'wethAbi' | 'mirrorAbi' | 'erc20Abi' | 'routerAbi'>,
): ChainAdapter {
  return {
    async getReserves(pairAddress: string) {
      const result = await testClient.publicClient.readContract({
        address: pairAddress as `0x${string}`,
        abi: deps.pairAbi(),
        functionName: 'getReserves',
        args: [],
      }) as [bigint, bigint, number];
      return { reserve0: result[0], reserve1: result[1] };
    },

    async executeSwap(params) {
      const isWethIn = params.tokenIn.toLowerCase() === wethAddress.toLowerCase();

      if (isWethIn) {
        await wallet.writeAndWait(
          wethAddress as `0x${string}`,
          deps.wethAbi(),
          'deposit',
          [],
          params.amountIn,
        );
      } else {
        await wallet.writeAndWait(
          params.tokenIn as `0x${string}`,
          deps.mirrorAbi(),
          'mint',
          [deployer, params.amountIn],
        );
      }

      await wallet.writeAndWait(
        params.tokenIn as `0x${string}`,
        deps.erc20Abi(),
        'approve',
        [params.routerAddress, params.amountIn],
      );

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const receipt = await wallet.writeAndWait(
        params.routerAddress as `0x${string}`,
        deps.routerAbi(),
        'swapExactTokensForTokens',
        [
          params.amountIn,
          0n,
          [params.tokenIn, params.tokenOut],
          deployer,
          deadline,
        ],
      );
      return { txHash: receipt.hash ?? '' };
    },

    async executeInjection(params) {
      await wallet.writeAndWait(
        params.tokenAddress as `0x${string}`,
        deps.mirrorAbi(),
        'mint',
        [params.pairAddress, params.tokenReserve],
      );

      await wallet.writeAndWait(
        params.wethAddress as `0x${string}`,
        deps.wethAbi(),
        'deposit',
        [],
        params.wethReserve,
      );
      await wallet.writeAndWait(
        params.wethAddress as `0x${string}`,
        deps.erc20Abi(),
        'transfer',
        [params.pairAddress, params.wethReserve],
      );

      await wallet.writeAndWait(
        params.pairAddress as `0x${string}`,
        deps.pairAbi(),
        'sync',
        [],
      );
    },

    async takeSnapshot() {
      try {
        return await testClient.snapshot();
      } catch {
        return '';
      }
    },

    async revertSnapshot(snapshotId: string) {
      if (!snapshotId) return;
      try {
        await testClient.revert(snapshotId);
      } catch {
        // no-op when revert is unsupported
      }
    },

    async mineBlock() {
      try {
        await testClient.mine(1);
      } catch {
        // no-op when mine is unsupported
      }
    },
  };
}

export async function createSimulationEngine(params: {
  accountIndex: number;
  rpcUrl: string;
  chainId: number;
  configOverrides?: { minDeviationBps?: number; tickIntervalMs?: number };
  deps: SimulationBootstrapDeps;
}): Promise<{ engine: SimulationEngine; feedCache: FeedCache }> {
  const { accountIndex, rpcUrl, chainId, configOverrides, deps } = params;

  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) throw new Error('DEX manifest not found. Run dex_deploy first.');

  let feedCache: FeedCache;
  try {
    feedCache = loadCache(deps.mainnetChainId);
  } catch {
    throw new Error('No feed cache found. Run dex_seed_from_gecko first.');
  }

  const table = await deps.readTranslationTable(manifest.contracts.weth9, manifest.chainId);
  if (!table || table.entries.length === 0) {
    throw new Error('Translation table not found or empty. Run dex_seed_from_gecko first.');
  }

  const factoryArtifact = deps.loadArtifact('UniswapV2Factory');
  const client = new EspaceClient({ rpcUrl, chainId });
  const tokenMap = new Map<string, { localAddress: string; pairAddress: string }>();

  for (const entry of table.entries) {
    const pairAddress = await client.publicClient.readContract({
      address: manifest.contracts.factory as `0x${string}`,
      abi: factoryArtifact.abi,
      functionName: 'getPair',
      args: [entry.localAddress, manifest.contracts.weth9],
    }) as string;

    if (pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000') {
      tokenMap.set(entry.realAddress.toLowerCase(), {
        localAddress: entry.localAddress,
        pairAddress,
      });
    }
  }

  if (tokenMap.size === 0) {
    throw new Error('No seeded pairs found. Run dex_seed_from_gecko first.');
  }

  const privateKey = resolvePrivateKey(accountIndex, 'espace');
  const account = getAccount(accountIndex);
  const testClient = new EspaceTestClient({ rpcUrl, chainId, privateKey, enableTestMode: true });
  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const adapter = buildChainAdapter(testClient, wallet, account.evmAddress, manifest.contracts.weth9, {
    pairAbi: deps.pairAbi,
    wethAbi: deps.wethAbi,
    mirrorAbi: deps.mirrorAbi,
    erc20Abi: deps.erc20Abi,
    routerAbi: deps.routerAbi,
  });

  const engine = await SimulationEngine.create({
    adapter,
    routerAddress: manifest.contracts.router02,
    wethAddress: manifest.contracts.weth9,
    accountIndex,
    feedCache,
    tokenMap,
    config: configOverrides,
    takeSnapshot: true,
  });

  return { engine, feedCache };
}
