import type { EspaceWalletClient } from '@cfxdevkit/core';
import type { TrackedContract } from '../../contracts.js';
import type { StableEntry, V2Manifest } from './dex-types.js';

export interface StablecoinDef {
  symbol: string;
  name: string;
  decimals: number;
  artifact: string | null;
  mintAmount: bigint;
  priceUsd: number;
  realAddress: string;
}

export interface StablecoinProgressOptions {
  ensureFunding?: (label: string, requiredWei: bigint) => Promise<void>;
  onProgress?: (message: string) => void;
}

export const STABLECOIN_DEFS: StablecoinDef[] = [
  { symbol: 'USDT0', name: 'USDT0', decimals: 6, artifact: 'MockUSDT0', mintAmount: 10_000_000n * 10n ** 6n, priceUsd: 1.0, realAddress: '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff' },
  { symbol: 'AxCNH', name: 'Axelar Bridged CNH', decimals: 6, artifact: 'MockAxCNH', mintAmount: 10_000_000n * 10n ** 6n, priceUsd: 0.137, realAddress: '0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e' },
  { symbol: 'USDT', name: 'Tether USD', decimals: 18, artifact: null, mintAmount: 10_000_000n * 10n ** 18n, priceUsd: 1.0, realAddress: '0xfe97e85d13abd9c1c33384e796f10b73905637ce' },
  { symbol: 'USDC', name: 'USD Coin', decimals: 18, artifact: null, mintAmount: 10_000_000n * 10n ** 18n, priceUsd: 1.0, realAddress: '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372' },
];

export const STABLE_CROSS_PAIRS: Array<{ base: string; quote: string; priceRatio: number; liquidityUsd: number }> = [
  // Intentionally empty for now. Cross-pairs can be added explicitly if needed.
];

export function stablecoinSymbols(): string[] {
  return STABLECOIN_DEFS.map((def) => def.symbol);
}

function filterStableDefs(selectedStablecoins?: string[]): StablecoinDef[] {
  const filterSet = selectedStablecoins?.length
    ? new Set(selectedStablecoins.map((symbol) => symbol.toUpperCase()))
    : null;
  return filterSet
    ? STABLECOIN_DEFS.filter((def) => filterSet.has(def.symbol.toUpperCase()))
    : STABLECOIN_DEFS;
}

export async function deployStablecoins(params: {
  wallet: EspaceWalletClient;
  deployer: string;
  chainId: number;
  trackedContracts?: TrackedContract[];
  options?: StablecoinProgressOptions;
  selectedStablecoins?: string[];
  registrySuffix: string;
  devkitNameSuffix: string;
  stableDeployGasBufferWei: bigint;
  loadArtifact: (name: string) => { abi: unknown[]; bytecode: string };
  mirrorAbi: () => unknown[];
  findTrackedContractByRealAddress: (contracts: TrackedContract[], realAddress: string) => TrackedContract | null;
  findTrackedContractByName: (contracts: TrackedContract[], name: string) => TrackedContract | null;
  saveContract: (contract: {
    name: string;
    address: string;
    chain: 'evm' | 'core';
    chainId: number;
    deployer: string;
    deployedAt: string;
    abi: unknown[];
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
}): Promise<Record<string, StableEntry>> {
  const {
    wallet,
    deployer,
    chainId,
    registrySuffix,
    devkitNameSuffix,
    stableDeployGasBufferWei,
    loadArtifact,
    mirrorAbi,
    findTrackedContractByRealAddress,
    findTrackedContractByName,
    saveContract,
  } = params;

  const trackedContracts = params.trackedContracts ?? [];
  const options = params.options ?? {};

  const mirrorArtifact = loadArtifact('MirrorERC20');
  const stables: Record<string, StableEntry> = {};
  const filteredDefs = filterStableDefs(params.selectedStablecoins);

  for (const [index, def] of filteredDefs.entries()) {
    options.onProgress?.(`Stablecoin ${index + 1}/${filteredDefs.length}: ${def.symbol}`);
    await options.ensureFunding?.(`${def.symbol} deployment`, stableDeployGasBufferWei);

    const displayName = def.name + devkitNameSuffix;
    const mintAbi = def.artifact ? loadArtifact(def.artifact).abi : mirrorAbi();
    const existing =
      findTrackedContractByRealAddress(trackedContracts, def.realAddress) ??
      findTrackedContractByName(trackedContracts, `${def.symbol}${registrySuffix}`);

    if (existing) {
      await wallet.writeAndWait(
        existing.address as `0x${string}`,
        mintAbi,
        'mint',
        [deployer, def.mintAmount],
      );
      options.onProgress?.(`Stablecoin reserve topped up: ${def.symbol}`);

      stables[def.symbol] = {
        symbol: def.symbol,
        name: displayName,
        decimals: def.decimals,
        address: existing.address,
      };
      continue;
    }

    let address: string;
    if (def.artifact) {
      const art = loadArtifact(def.artifact);
      address = await wallet.deployContract(art.abi, art.bytecode, []);
    } else {
      address = await wallet.deployContract(
        mirrorArtifact.abi,
        mirrorArtifact.bytecode,
        [displayName, def.symbol, def.decimals],
      );
    }

    await wallet.writeAndWait(
      address as `0x${string}`,
      mintAbi,
      'mint',
      [deployer, def.mintAmount],
    );

    stables[def.symbol] = {
      symbol: def.symbol,
      name: displayName,
      decimals: def.decimals,
      address,
    };

    await saveContract({
      name: `${def.symbol}${registrySuffix}`,
      address,
      chain: 'evm',
      chainId,
      deployer,
      deployedAt: new Date().toISOString(),
      abi: def.artifact
        ? loadArtifact(def.artifact).abi
        : mirrorArtifact.abi,
      metadata: {
        realAddress: def.realAddress,
        symbol: def.symbol,
        decimals: def.decimals,
      },
    });

    options.onProgress?.(`Stablecoin ${index + 1}/${filteredDefs.length}: ${def.symbol} ready`);
  }

  return stables;
}

export async function seedStablecoinPools(params: {
  wallet: EspaceWalletClient;
  deployer: string;
  manifest: V2Manifest;
  stables: Record<string, StableEntry>;
  wcfxPriceUsd: number;
  options?: StablecoinProgressOptions;
  selectedStablecoins?: string[];
  stablePairGasBufferWei: bigint;
  stableCrossPairGasBufferWei: bigint;
  loadArtifact: (name: string) => { abi: unknown[]; bytecode: string };
  erc20Abi: () => unknown[];
  mirrorAbi: () => unknown[];
}): Promise<string[]> {
  const {
    wallet,
    deployer,
    manifest,
    stables,
    wcfxPriceUsd,
    stablePairGasBufferWei,
    stableCrossPairGasBufferWei,
    loadArtifact,
    erc20Abi,
    mirrorAbi,
  } = params;

  const options = params.options ?? {};

  const routerArtifact = loadArtifact('UniswapV2Router02');
  const lines: string[] = [];
  const stableScale = 0.01;
  const stableLiquidityUsd = 100_000;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const filteredDefs = filterStableDefs(params.selectedStablecoins);

  for (const [index, def] of filteredDefs.entries()) {
    const entry = stables[def.symbol];
    if (!entry) continue;

    options.onProgress?.(`Stable pool ${index + 1}/${filteredDefs.length}: ${def.symbol}/WCFX`);

    const halfUsd = (stableLiquidityUsd * stableScale) / 2;
    const tokenAmount = BigInt(Math.floor((halfUsd / def.priceUsd) * (10 ** def.decimals)));
    const wcfxAmount = BigInt(Math.floor((halfUsd / wcfxPriceUsd) * (10 ** 18)));

    if (tokenAmount === 0n || wcfxAmount === 0n) {
      lines.push(`  ⚠  ${def.symbol}/WCFX: skipped (zero reserves)`);
      continue;
    }

    try {
      await options.ensureFunding?.(`${def.symbol}/WCFX pool`, wcfxAmount + stablePairGasBufferWei);

      const mintAbi = def.artifact ? loadArtifact(def.artifact).abi : mirrorAbi();
      await wallet.writeAndWait(entry.address as `0x${string}`, mintAbi, 'mint', [deployer, tokenAmount]);
      await wallet.writeAndWait(entry.address as `0x${string}`, erc20Abi(), 'approve', [manifest.contracts.router02, tokenAmount]);

      await wallet.writeAndWait(
        manifest.contracts.router02 as `0x${string}`,
        routerArtifact.abi,
        'addLiquidityETH',
        [entry.address, tokenAmount, 0n, 0n, deployer, deadline],
        wcfxAmount,
      );

      const price = (Number(wcfxAmount) / 1e18) / (Number(tokenAmount) / 10 ** def.decimals);
      lines.push(`  ✅ ${def.symbol}/WCFX  ${tokenAmount} ${def.symbol} + ${wcfxAmount} WCFX  price=${price.toPrecision(4)} WCFX/${def.symbol}`);
    } catch (err) {
      lines.push(`  ❌ ${def.symbol}/WCFX: ${String(err).split('\n')[0]}`);
    }
  }

  for (const [index, cp] of STABLE_CROSS_PAIRS.entries()) {
    const base = stables[cp.base];
    const quote = stables[cp.quote];
    if (!base || !quote) continue;

    options.onProgress?.(`Stable cross-pair ${index + 1}/${STABLE_CROSS_PAIRS.length}: ${cp.base}/${cp.quote}`);

    const baseDef = STABLECOIN_DEFS.find((d) => d.symbol === cp.base);
    const quoteDef = STABLECOIN_DEFS.find((d) => d.symbol === cp.quote);
    if (!baseDef || !quoteDef) continue;

    const halfUsd = (cp.liquidityUsd * stableScale) / 2;
    const baseAmount = BigInt(Math.floor((halfUsd / baseDef.priceUsd) * (10 ** baseDef.decimals)));
    const quoteAmount = BigInt(Math.floor((halfUsd / quoteDef.priceUsd) * (10 ** quoteDef.decimals)));

    try {
      await options.ensureFunding?.(`${cp.base}/${cp.quote} pool`, stableCrossPairGasBufferWei);

      const mintBaseAbi = baseDef.artifact ? loadArtifact(baseDef.artifact).abi : mirrorAbi();
      const mintQuoteAbi = quoteDef.artifact ? loadArtifact(quoteDef.artifact).abi : mirrorAbi();

      await wallet.writeAndWait(base.address as `0x${string}`, mintBaseAbi, 'mint', [deployer, baseAmount]);
      await wallet.writeAndWait(quote.address as `0x${string}`, mintQuoteAbi, 'mint', [deployer, quoteAmount]);

      await wallet.writeAndWait(base.address as `0x${string}`, erc20Abi(), 'approve', [manifest.contracts.router02, baseAmount]);
      await wallet.writeAndWait(quote.address as `0x${string}`, erc20Abi(), 'approve', [manifest.contracts.router02, quoteAmount]);

      await wallet.writeAndWait(
        manifest.contracts.router02 as `0x${string}`,
        routerArtifact.abi,
        'addLiquidity',
        [base.address, quote.address, baseAmount, quoteAmount, 0n, 0n, deployer, deadline],
      );

      lines.push(`  ✅ ${cp.base}/${cp.quote}  base=${baseAmount}  quote=${quoteAmount}  ratio=${cp.priceRatio}`);
    } catch (err) {
      lines.push(`  ❌ ${cp.base}/${cp.quote}: ${String(err).split('\n')[0]}`);
    }
  }

  return lines;
}
