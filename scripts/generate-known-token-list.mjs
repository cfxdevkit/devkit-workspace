#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const CHAIN = 'cfx';
const CHAIN_ID = 1030;
const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const WCFX_MAINNET = '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b';
const DEFAULT_OUTPUT = resolve(repoRoot, 'dex-ui', 'public', 'known-tokens.json');
const DEFAULT_PRESET_OUTPUT = resolve(repoRoot, 'dex-ui', 'public', 'pool-import-presets.json');
const TOKEN_ICON_OVERRIDES_PATH = resolve(repoRoot, 'dex-ui', 'public', 'token-icon-overrides.json');
const GT_ACCEPT = 'application/json;version=20230203';
const GT_BATCH_SIZE = 20;
const MAX_CANDIDATE_POOLS_PER_TOKEN = 6;
const DEFAULT_SELECTED_POOL_COUNT = 5;

const STABLECOIN_ADDRESSES = new Set([
  '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',
  '0xfe97e85d13abd9c1c33384e796f10b73905637ce',
  '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '0xdac17f958d2ee523a2206206994597c13d831ec7',
  '0x6b175474e89094c44da98b954eedeac495271d0f',
]);

const CURATED_TOKENS = [
  { address: WCFX_MAINNET, symbol: 'WCFX', name: 'Wrapped CFX', decimals: 18 },
  { address: '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff', symbol: 'USDT0', name: 'USDT0', decimals: 6 },
  { address: '0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e', symbol: 'AxCNH', name: 'AxCNH', decimals: 6 },
  { address: '0xfe97e85d13abd9c1c33384e796f10b73905637ce', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
  { address: '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
  { address: '0xa47f43de2f9623acb395ca4905746496d2014d57', symbol: 'ETH', name: 'Ethereum', decimals: 18 },
  { address: '0x1f545487c62e5acfea45dcadd9c627361d1616d8', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
].map((token) => ({ ...token, address: token.address.toLowerCase() }));

function parseArgs(argv) {
  let count = 24;
  let output = DEFAULT_OUTPUT;
  let presetOutput = DEFAULT_PRESET_OUTPUT;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--count' && argv[index + 1]) {
      count = Number.parseInt(argv[index + 1], 10) || count;
      index += 1;
      continue;
    }
    if (arg.startsWith('--count=')) {
      count = Number.parseInt(arg.slice('--count='.length), 10) || count;
      continue;
    }
    if (arg === '--output' && argv[index + 1]) {
      output = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      output = resolve(process.cwd(), arg.slice('--output='.length));
      presetOutput = resolve(dirname(output), 'pool-import-presets.json');
      continue;
    }
    if (arg === '--preset-output' && argv[index + 1]) {
      presetOutput = resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--preset-output=')) {
      presetOutput = resolve(process.cwd(), arg.slice('--preset-output='.length));
    }
  }

  return { count, output, presetOutput };
}

function isNativeToken(address) {
  return address.toLowerCase() === WCFX_MAINNET;
}

function isStablecoin(address) {
  return STABLECOIN_ADDRESSES.has(address.toLowerCase());
}

function normalizeAddress(id) {
  const idx = id.indexOf('_0x');
  return (idx >= 0 ? id.slice(idx + 1) : id).toLowerCase();
}

function chunk(items, size) {
  const groups = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function toNumber(value) {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function isEffigyIcon(iconUrl) {
  return typeof iconUrl === 'string' && iconUrl.includes('effigy.im');
}

function isSwappiIcon(iconUrl) {
  return typeof iconUrl === 'string' && iconUrl.includes('app.swappi.io/static/media');
}

function isFallbackIcon(iconUrl) {
  return isEffigyIcon(iconUrl) || isSwappiIcon(iconUrl);
}

function loadExistingCatalog(output) {
  if (!existsSync(output)) return new Map();

  try {
    const raw = readFileSync(output, 'utf-8');
    const data = JSON.parse(raw);
    const map = new Map();
    for (const token of data?.tokens ?? []) {
      if (!token?.address) continue;
      map.set(token.address.toLowerCase(), {
        address: token.address.toLowerCase(),
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        iconUrl: token.iconUrl ?? null,
      });
    }
    return map;
  } catch (error) {
    console.warn(`Failed to read existing catalog at ${output}: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}

function loadIconOverrides() {
  if (!existsSync(TOKEN_ICON_OVERRIDES_PATH)) return new Map();
  try {
    const raw = readFileSync(TOKEN_ICON_OVERRIDES_PATH, 'utf-8');
    const data = JSON.parse(raw);
    const map = new Map();
    for (const entry of data?.icons ?? []) {
      if (!entry?.address || !entry?.iconUrl) continue;
      map.set(entry.address.toLowerCase(), entry.iconUrl);
    }
    return map;
  } catch (error) {
    console.warn(`Failed to read token icon overrides at ${TOKEN_ICON_OVERRIDES_PATH}: ${error instanceof Error ? error.message : String(error)}`);
    return new Map();
  }
}

function resolveTokenDescriptor(address, tokenMetadata, existingCatalog, curatedIndex) {
  const metadata = tokenMetadata.get(address);
  const existingToken = existingCatalog.get(address);
  const curatedToken = curatedIndex.get(address);
  return {
    address,
    symbol: metadata?.symbol ?? existingToken?.symbol ?? curatedToken?.symbol ?? 'UNKNOWN',
    name: metadata?.name ?? existingToken?.name ?? curatedToken?.name ?? metadata?.symbol ?? 'Unknown Token',
    decimals: metadata?.decimals ?? existingToken?.decimals ?? curatedToken?.decimals ?? 18,
  };
}

function createPoolRecord(pool) {
  const baseTokenAddress = normalizeAddress(pool.relationships.base_token.data.id);
  const quoteTokenAddress = normalizeAddress(pool.relationships.quote_token.data.id);
  return {
    address: normalizeAddress(pool.attributes.address),
    name: typeof pool.attributes.name === 'string' ? pool.attributes.name : `${baseTokenAddress}/${quoteTokenAddress}`,
    baseTokenAddress,
    quoteTokenAddress,
    reserveUsd: toNumber(pool.attributes.reserve_in_usd),
    volume24h: toNumber(pool.attributes.volume_usd?.h24),
    baseTokenPriceUsd: toNumber(pool.attributes.base_token_price_usd),
    quoteTokenPriceUsd: toNumber(pool.attributes.quote_token_price_usd),
  };
}

function recordCandidatePool(candidatePoolsByToken, tokenAddress, poolRecord, tokenSide) {
  if (isNativeToken(tokenAddress)) return;

  let tokenPools = candidatePoolsByToken.get(tokenAddress);
  if (!tokenPools) {
    tokenPools = new Map();
    candidatePoolsByToken.set(tokenAddress, tokenPools);
  }

  const existing = tokenPools.get(poolRecord.address);
  if (!existing || poolRecord.reserveUsd > existing.reserveUsd) {
    tokenPools.set(poolRecord.address, {
      poolAddress: poolRecord.address,
      tokenSide,
      reserveUsd: poolRecord.reserveUsd,
    });
  }
}

function buildKnownPoolEntry(poolRecord, tokenMetadata, existingCatalog, curatedIndex) {
  if (!poolRecord) return null;

  const baseToken = resolveTokenDescriptor(poolRecord.baseTokenAddress, tokenMetadata, existingCatalog, curatedIndex);
  const quoteToken = resolveTokenDescriptor(poolRecord.quoteTokenAddress, tokenMetadata, existingCatalog, curatedIndex);

  return {
    address: poolRecord.address,
    label: `${baseToken.symbol}/${quoteToken.symbol}`,
    baseToken,
    quoteToken,
    reserveUsd: poolRecord.reserveUsd,
    volume24h: poolRecord.volume24h,
    baseTokenPriceUsd: poolRecord.baseTokenPriceUsd || null,
    quoteTokenPriceUsd: poolRecord.quoteTokenPriceUsd || null,
    isWcfxPair: isNativeToken(poolRecord.baseTokenAddress) || isNativeToken(poolRecord.quoteTokenAddress),
  };
}

function buildKnownTokenPoolRef(candidate, poolRecord, tokenMetadata, existingCatalog, curatedIndex) {
  if (!candidate || !poolRecord) return null;

  const baseToken = resolveTokenDescriptor(poolRecord.baseTokenAddress, tokenMetadata, existingCatalog, curatedIndex);
  const quoteToken = resolveTokenDescriptor(poolRecord.quoteTokenAddress, tokenMetadata, existingCatalog, curatedIndex);
  const isBaseSide = candidate.tokenSide === 'base';
  const token = isBaseSide ? baseToken : quoteToken;
  const counterparty = isBaseSide ? quoteToken : baseToken;

  return {
    poolAddress: poolRecord.address,
    label: `${baseToken.symbol}/${quoteToken.symbol}`,
    tokenSide: candidate.tokenSide,
    token,
    counterparty,
    reserveUsd: poolRecord.reserveUsd,
    volume24h: poolRecord.volume24h,
    tokenPriceUsd: isBaseSide
      ? (poolRecord.baseTokenPriceUsd || null)
      : (poolRecord.quoteTokenPriceUsd || null),
    isWcfxPair: isNativeToken(poolRecord.baseTokenAddress) || isNativeToken(poolRecord.quoteTokenAddress),
  };
}

function toTokenMetadata(resource) {
  const attributes = resource?.attributes ?? {};
  const address = typeof resource?.id === 'string' ? normalizeAddress(resource.id) : null;
  if (!address) return null;

  return {
    address,
    symbol: typeof attributes.symbol === 'string' && attributes.symbol ? attributes.symbol : null,
    name: typeof attributes.name === 'string' && attributes.name ? attributes.name : null,
    decimals: typeof attributes.decimals === 'number' ? attributes.decimals : null,
    imageUrl: typeof attributes.image_url === 'string' && attributes.image_url ? attributes.image_url : null,
  };
}

function mergeTokenMetadata(existing, next) {
  if (!existing) return next;
  return {
    address: existing.address,
    symbol: next.symbol ?? existing.symbol,
    name: next.name ?? existing.name,
    decimals: next.decimals ?? existing.decimals,
    imageUrl: (() => {
      const nextImage = typeof next.imageUrl === 'string' && next.imageUrl.length > 0 ? next.imageUrl : null;
      const existingImage = typeof existing.imageUrl === 'string' && existing.imageUrl.length > 0 ? existing.imageUrl : null;
      if (nextImage && !isFallbackIcon(nextImage)) return nextImage;
      if (existingImage && !isFallbackIcon(existingImage)) return existingImage;
      return nextImage ?? existingImage;
    })(),
  };
}

function upsertTokenMetadata(map, metadata) {
  if (!metadata?.address) return;
  map.set(metadata.address, mergeTokenMetadata(map.get(metadata.address), metadata));
}

async function gtFetch(path) {
  let lastError = null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(`${GT_BASE}${path}`, {
      headers: { Accept: GT_ACCEPT },
    });

    if (response.ok) {
      return response.json();
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(`GeckoTerminal ${path} -> HTTP ${response.status}`);
    }

    lastError = new Error(`GeckoTerminal ${path} -> HTTP ${response.status}`);
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 2000 * (attempt + 1);
    await sleep(waitMs);
  }

  throw lastError ?? new Error(`GeckoTerminal ${path} failed`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchTopPools(page) {
  const data = await gtFetch(`/networks/${CHAIN}/pools?page=${page}&sort=h24_volume_usd_desc&include=base_token,quote_token`);
  return {
    pools: data.data ?? [],
    included: Array.isArray(data.included) ? data.included : [],
  };
}

async function fetchTokensMulti(addresses) {
  if (!addresses.length) return [];
  const data = await gtFetch(`/networks/${CHAIN}/tokens/multi/${addresses.join(',')}`);
  return Array.isArray(data.data) ? data.data : [];
}

async function resolveTokenIcon(address, preferredIconUrl, existingIconUrl, overrideIconUrl) {
  if (typeof overrideIconUrl === 'string' && overrideIconUrl.length > 0) {
    return overrideIconUrl;
  }

  if (typeof existingIconUrl === 'string' && existingIconUrl.length > 0 && !isEffigyIcon(existingIconUrl) && !isSwappiIcon(existingIconUrl)) {
    return existingIconUrl;
  }

  try {
    const res = await fetch(
      `https://evmapi.confluxscan.org/api?module=token&action=tokeninfo&contractaddress=${address}`,
      { headers: { Accept: 'application/json' } },
    );
    if (res.ok) {
      const data = await res.json();
      const iconUrl = data?.result?.[0]?.iconurl ?? data?.result?.[0]?.iconUrl;
      if (typeof iconUrl === 'string' && iconUrl.length > 0) {
        return iconUrl;
      }
    }
  } catch {
    // Fall through.
  }

  const cdnUrl = `https://conflux-static.oss-cn-beijing.aliyuncs.com/icons/${address.toLowerCase()}.png`;
  try {
    const cdnCheck = await fetch(cdnUrl, { method: 'HEAD' });
    if (cdnCheck.ok) {
      return cdnUrl;
    }
  } catch {
    // Fall through.
  }

  if (typeof preferredIconUrl === 'string' && preferredIconUrl.length > 0 && !isSwappiIcon(preferredIconUrl)) {
    return preferredIconUrl;
  }

  if (typeof existingIconUrl === 'string' && existingIconUrl.length > 0 && !isSwappiIcon(existingIconUrl)) {
    return existingIconUrl;
  }

  return `https://effigy.im/a/${address}.svg`;
}

async function selectTopTokens(count, interReqMs) {
  const best = new Map();
  const tokenMetadata = new Map();
  const poolCatalog = new Map();
  const candidatePoolsByToken = new Map();
  const minCandidates = count * 3;
  const maxPages = 10;
  let page = 1;

  while (best.size < minCandidates && page <= maxPages) {
    let response = { pools: [], included: [] };
    try {
      await sleep(interReqMs);
      response = await fetchTopPools(page);
      page += 1;
    } catch (error) {
      if (best.size > 0) {
        console.warn(`Pool fetch stopped early on page ${page}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
      throw error;
    }
    const { pools, included } = response;
    if (!pools.length) break;

    for (const resource of included) {
      const metadata = toTokenMetadata(resource);
      if (metadata) upsertTokenMetadata(tokenMetadata, metadata);
    }

    for (const pool of pools) {
      const baseAddr = normalizeAddress(pool.relationships.base_token.data.id);
      const quoteAddr = normalizeAddress(pool.relationships.quote_token.data.id);
      const poolLiq = Number.parseFloat(pool.attributes.reserve_in_usd) || 0;
      const poolRecord = createPoolRecord(pool);

      poolCatalog.set(poolRecord.address, poolRecord);
      recordCandidatePool(candidatePoolsByToken, baseAddr, poolRecord, 'base');
      recordCandidatePool(candidatePoolsByToken, quoteAddr, poolRecord, 'quote');

      if (isNativeToken(baseAddr)) {
        if (!isStablecoin(quoteAddr) && !isNativeToken(quoteAddr)) {
          const existing = best.get(quoteAddr);
          const existingLiq = existing ? Number.parseFloat(existing.pool.attributes.reserve_in_usd) || 0 : 0;
          if (!existing || poolLiq > existingLiq) {
            best.set(quoteAddr, { pool, baseToken: quoteAddr, quoteMode: true });
          }
        }
        continue;
      }

      if (isStablecoin(baseAddr)) continue;

      const existing = best.get(baseAddr);
      const existingLiq = existing ? Number.parseFloat(existing.pool.attributes.reserve_in_usd) || 0 : 0;
      if (!existing || poolLiq > existingLiq) {
        best.set(baseAddr, { pool, baseToken: baseAddr, quoteMode: false });
      }
    }
  }

  return {
    selections: [...best.values()]
    .sort((left, right) => {
      const leftLiq = Number.parseFloat(left.pool.attributes.reserve_in_usd) || 0;
      const rightLiq = Number.parseFloat(right.pool.attributes.reserve_in_usd) || 0;
      return rightLiq - leftLiq;
    })
    .slice(0, count),
    tokenMetadata,
    poolCatalog,
    candidatePoolsByToken,
  };
}

async function buildCatalog({ count, output }) {
  const curatedIndex = new Map(CURATED_TOKENS.map((token) => [token.address, token]));
  const existingCatalog = loadExistingCatalog(output);
  const iconOverrides = loadIconOverrides();
  const { selections, tokenMetadata, poolCatalog, candidatePoolsByToken } = await selectTopTokens(count, 1000);

  for (const existingToken of existingCatalog.values()) {
    upsertTokenMetadata(tokenMetadata, {
      address: existingToken.address,
      symbol: existingToken.symbol ?? null,
      name: existingToken.name ?? null,
      decimals: typeof existingToken.decimals === 'number' ? existingToken.decimals : null,
      imageUrl: isFallbackIcon(existingToken.iconUrl) ? null : existingToken.iconUrl ?? null,
    });
  }

  const addresses = [
    ...new Set([
      ...selections.map((selection) => selection.baseToken),
      ...CURATED_TOKENS.map((token) => token.address),
      ...existingCatalog.keys(),
      ...candidatePoolsByToken.keys(),
    ]),
  ];

  const missingMetadata = addresses.filter((address) => {
    const metadata = tokenMetadata.get(address);
    return !metadata?.symbol
      || !metadata?.name
      || metadata?.decimals == null
      || !metadata?.imageUrl
      || isFallbackIcon(metadata.imageUrl);
  });

  for (const group of chunk(missingMetadata, GT_BATCH_SIZE)) {
    try {
      const resources = await fetchTokensMulti(group);
      for (const resource of resources) {
        const metadata = toTokenMetadata(resource);
        if (metadata) upsertTokenMetadata(tokenMetadata, metadata);
      }
    } catch (error) {
      console.warn(`Token metadata batch failed for ${group.length} addresses: ${error instanceof Error ? error.message : String(error)}`);
    }
    await sleep(1000);
  }

  const tokens = [];
  const selectedPoolAddresses = new Set();

  for (const address of addresses) {
    const curated = curatedIndex.get(address);
    const metadata = tokenMetadata.get(address);
    const existingToken = existingCatalog.get(address);
    const iconUrl = await resolveTokenIcon(address, metadata?.imageUrl, existingToken?.iconUrl, iconOverrides.get(address));
    const candidatePools = [...(candidatePoolsByToken.get(address)?.values() ?? [])]
      .map((candidate) => buildKnownTokenPoolRef(
        candidate,
        poolCatalog.get(candidate.poolAddress),
        tokenMetadata,
        existingCatalog,
        curatedIndex,
      ))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.reserveUsd !== right.reserveUsd) return right.reserveUsd - left.reserveUsd;
        return right.volume24h - left.volume24h;
      })
      .slice(0, MAX_CANDIDATE_POOLS_PER_TOKEN);

    for (const pool of candidatePools) {
      selectedPoolAddresses.add(pool.poolAddress);
    }

    const bestPool = candidatePools[0] ?? null;
    const wcfxPool = candidatePools.find((pool) => pool.isWcfxPair) ?? null;

    tokens.push({
      address,
      symbol: metadata?.symbol ?? existingToken?.symbol ?? curated?.symbol ?? 'UNKNOWN',
      name: metadata?.name ?? existingToken?.name ?? curated?.name ?? metadata?.symbol ?? 'Unknown Token',
      decimals: metadata?.decimals ?? existingToken?.decimals ?? curated?.decimals ?? 18,
      iconUrl,
      bestPool,
      wcfxPool,
      candidatePools,
    });

    await sleep(100);
  }

  const pools = [...selectedPoolAddresses]
    .map((poolAddress) => buildKnownPoolEntry(
      poolCatalog.get(poolAddress),
      tokenMetadata,
      existingCatalog,
      curatedIndex,
    ))
    .filter(Boolean)
    .sort((left, right) => {
      if (left.reserveUsd !== right.reserveUsd) return right.reserveUsd - left.reserveUsd;
      return right.volume24h - left.volume24h;
    });

  const selectionRank = new Map(selections.map((selection, index) => [selection.baseToken, index]));
  tokens.sort((left, right) => {
    const leftRank = selectionRank.get(left.address) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = selectionRank.get(right.address) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank === rightRank) return left.symbol.localeCompare(right.symbol);
    return leftRank - rightRank;
  });

  return {
    version: 3,
    chainId: CHAIN_ID,
    generatedAt: new Date().toISOString(),
    pools,
    tokens,
  };
}

function buildPoolImportPreset(catalog) {
  const selectedPoolAddresses = (catalog.pools ?? [])
    .filter((pool) => pool.isWcfxPair && !isStablecoin(pool.baseToken.address) && !isStablecoin(pool.quoteToken.address))
    .sort((left, right) => {
      if (left.reserveUsd !== right.reserveUsd) return right.reserveUsd - left.reserveUsd;
      return right.volume24h - left.volume24h;
    })
    .slice(0, DEFAULT_SELECTED_POOL_COUNT)
    .map((pool) => pool.address.toLowerCase());

  return {
    version: 1,
    chainId: CHAIN_ID,
    updatedAt: catalog.generatedAt,
    selectedPoolAddresses,
  };
}

async function main() {
  const { count, output, presetOutput } = parseArgs(process.argv.slice(2));
  const catalog = await buildCatalog({ count, output });
  const poolImportPreset = buildPoolImportPreset(catalog);

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(catalog, null, 2)}\n`);
  mkdirSync(dirname(presetOutput), { recursive: true });
  writeFileSync(presetOutput, `${JSON.stringify(poolImportPreset, null, 2)}\n`);

  console.log(`Wrote ${catalog.tokens.length} known tokens to ${output}`);
  console.log(`Wrote ${poolImportPreset.selectedPoolAddresses.length} default pool presets to ${presetOutput}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
