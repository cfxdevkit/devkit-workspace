import { computeInitialReserves, autoScaleFactor, reservesToPrice, mine as mineBlocks } from '@cfxdevkit/shared';
import type { EspaceWalletClient } from '@cfxdevkit/core';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { TokenMirror } from '@cfxdevkit/shared';
import type { V2Manifest } from './dex-types.js';

type SaveContractInput = {
  name: string;
  address: string;
  chain: 'evm';
  chainId: number;
  deployer: string;
  deployedAt: string;
  abi: unknown[];
  metadata?: Record<string, unknown>;
};

type SeedFeed = {
  tokens: Array<{
    realAddress: string;
    name: string;
    symbol: string;
    decimals: number;
    priceUsd: number;
    iconCached?: boolean;
    poolAddress?: string;
    reserveUsd?: number;
    volume24h?: number;
    candles?: unknown;
  }>;
};

export async function seedMirrorPools(params: {
  feed: SeedFeed;
  manifest: V2Manifest;
  wcfxPriceUsd: number;
  wallet: EspaceWalletClient;
  deployer: string;
  fundingLines: string[];
  mirrorTable: TokenMirror;
  mirrorArtifact: ContractArtifact;
  routerArtifact: ContractArtifact;
  devkitNameSuffix: string;
  registrySuffix: string;
  tokenPairGasBufferWei: bigint;
  erc20Abi: () => unknown[];
  ensureFunding: (label: string, requiredWei: bigint) => Promise<void>;
  saveContract: (input: SaveContractInput) => Promise<unknown>;
}): Promise<{ lines: string[]; seededCount: number; skippedCount: number }> {
  const {
    feed,
    manifest,
    wcfxPriceUsd,
    wallet,
    deployer,
    mirrorTable,
    mirrorArtifact,
    routerArtifact,
    devkitNameSuffix,
    registrySuffix,
    tokenPairGasBufferWei,
    erc20Abi,
    ensureFunding,
    saveContract,
  } = params;

  const lines: string[] = [];
  let seededCount = 0;
  let skippedCount = 0;

  for (const token of feed.tokens) {
    console.error(`[dex_seed] Step 2-6: Pool ${seededCount + skippedCount + 1}/${feed.tokens.length} — ${token.symbol}…`);
    const realAddr = token.realAddress.toLowerCase();
    const existing = mirrorTable.getLocalAddress(realAddr);

    let localAddr = existing;

    try {
      if (!localAddr) {
        const mirrorName = token.name + devkitNameSuffix;
        localAddr = await wallet.deployContract(
          mirrorArtifact.abi,
          mirrorArtifact.bytecode,
          [mirrorName, token.symbol, token.decimals],
        );
        mirrorTable.recordMirror(token as Parameters<typeof mirrorTable.recordMirror>[0], localAddr);
        lines.push(`  🪞 Mirrored  ${token.symbol.padEnd(10)} → ${localAddr}`);
        await saveContract({
          name: `${token.symbol}${registrySuffix}`,
          address: localAddr,
          chain: 'evm',
          chainId: manifest.chainId,
          deployer,
          deployedAt: new Date().toISOString(),
          abi: mirrorArtifact.abi,
          metadata: {
            realAddress: token.realAddress,
            symbol: token.symbol,
            decimals: token.decimals,
          },
        }).catch(() => {
          // non-fatal
        });
      } else {
        mirrorTable.recordMirror(token as Parameters<typeof mirrorTable.recordMirror>[0], localAddr);
        lines.push(`  ♻️  Reusing   ${token.symbol.padEnd(10)} → ${localAddr}`);
      }

      const scale = autoScaleFactor(token.priceUsd, wcfxPriceUsd);
      const reserves = computeInitialReserves(token as Parameters<typeof computeInitialReserves>[0], wcfxPriceUsd, scale);

      await ensureFunding(`${token.symbol}/WCFX pool`, reserves.reserve1 + tokenPairGasBufferWei);

      await wallet.writeAndWait(
        localAddr as `0x${string}`,
        mirrorArtifact.abi,
        'mint',
        [deployer, reserves.reserve0],
      );

      await wallet.writeAndWait(
        localAddr as `0x${string}`,
        erc20Abi(),
        'approve',
        [manifest.contracts.router02, reserves.reserve0],
      );

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await wallet.writeAndWait(
        manifest.contracts.router02 as `0x${string}`,
        routerArtifact.abi,
        'addLiquidityETH',
        [
          localAddr,
          reserves.reserve0,
          0n,
          0n,
          deployer,
          deadline,
        ],
        reserves.reserve1,
      );

      const price = reservesToPrice(reserves.reserve0, reserves.reserve1, token.decimals);
      lines.push(
        `     reserve0=${reserves.reserve0} (${token.symbol})  ` +
        `reserve1=${reserves.reserve1} (WCFX)  ` +
        `price=${price.toPrecision(4)} WCFX per ${token.symbol}  ` +
        `($${token.priceUsd.toPrecision(4)})`,
      );

      seededCount++;
      console.error(`[dex_seed]   ✓ ${token.symbol} seeded`);

      if (seededCount % 4 === 0) {
        try {
          await mineBlocks(10);
        } catch {
          // non-critical
        }
      }
    } catch (err) {
      lines.push(`  ❌  ${token.symbol}: ${String(err).split('\n')[0]}`);
      skippedCount++;
      console.error(`[dex_seed]   ✗ ${token.symbol} failed`);
    }
  }

  return { lines, seededCount, skippedCount };
}
