/**
 * dex-feed.ts
 *
 * FeedFetcher — the ONLY component that makes outbound HTTP calls to GeckoTerminal.
 * Run once to populate .feeds/{chainId}-{timestamp}.json, then operate fully offline.
 *
 * CRITICAL: Never call GeckoTerminal from inside the simulation loop.
 * All data must be pre-cached. Live calls break determinism and reproducibility.
 *
 * Rate limit: 30 req/min free tier → 100ms inter-request delay is used.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isStablecoin, isNativeToken, chainIdToGeckoSlug } from './network-config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Candle {
  timestamp: number;
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
}

export interface VWAPPoint {
  timestamp: number;
  price:     number;   // (high + low + close) / 3
  volume:    number;
  close:     number;   // raw close, stored for reference
}

export interface TokenFeedData {
  realAddress:  string;       // on mainnet/target chain, lowercase
  poolAddress:  string;       // pool queried for OHLCV
  symbol:       string;
  name:         string;
  decimals:     number;
  coingeckoId?: string;
  iconCached:   boolean;
  priceUsd:     number;       // spot price at fetch time
  reserveUsd:   number;       // total liquidity at fetch time
  volume24h:    number;
  candles:      VWAPPoint[];  // oldest-first (reversed from API)
}

export interface FeedCache {
  version:      '1.0';
  chainId:      number;
  chain:        string;          // GeckoTerminal slug
  fetchedAt:    number;          // Unix ms
  delayMs:      number;
  selectionKey?: string;
  wcfxPriceUsd?: number;         // WCFX/CFX spot price in USD at fetch time
  tokens:       TokenFeedData[];
}

export interface TokenSourceSelection {
  tokenAddress: string;
  poolAddress: string;
  quoteMode?: boolean;
}

export interface FeedFetcherConfig {
  chainId:       number;
  tokenCount:    number;    // default: 10
  candleAgg:     number;    // default: 5 (minutes)
  historyHours:  number;    // default: 24
  delayMinutes:  number;    // default: 15
  includeIcons:  boolean;   // default: true
  skipStables:   boolean;   // default: true
  cacheDir:      string;    // default: '.feeds'
  interReqMs:    number;    // default: 100 (rate-limit headroom)
}

const DEFAULT_CONFIG: Omit<FeedFetcherConfig, 'chainId'> = {
  tokenCount:   10,
  candleAgg:    5,
  historyHours: 24,
  delayMinutes: 15,
  includeIcons: true,
  skipStables:  true,
  cacheDir:     '.feeds',
  interReqMs:   100,
};

const GT_BASE = 'https://api.geckoterminal.com/api/v2';

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function gtFetch(path: string): Promise<unknown> {
  const resp = await fetch(`${GT_BASE}${path}`, {
    headers: { Accept: 'application/json;version=20230302' },
  });
  if (!resp.ok) {
    throw new Error(`GeckoTerminal ${path} → HTTP ${resp.status}`);
  }
  return resp.json();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── VWAP computation ──────────────────────────────────────────────────────────

function computeVWAP(candles: Candle[]): VWAPPoint[] {
  return candles.map(c => ({
    timestamp: c.timestamp,
    price:     (c.high + c.low + c.close) / 3,
    volume:    c.volume,
    close:     c.close,
  }));
}

// ── GeckoTerminal raw response types ──────────────────────────────────────────

interface GtPoolAttributes {
  address:                    string;
  name:                       string;
  base_token_price_usd:       string;
  quote_token_price_usd:      string;
  reserve_in_usd:             string;
  volume_usd:                 { h24: string };
  price_change_percentage:    { h24: string };
}
interface GtPoolRelationships {
  base_token:  { data: { id: string } };
  quote_token: { data: { id: string } };
}
interface GtPool {
  id:            string;
  attributes:    GtPoolAttributes;
  relationships: GtPoolRelationships;
}

interface GtTokenAttributes {
  symbol:               string;
  name:                 string;
  decimals:             number;
  coingecko_coin_id?:   string;
  image_url?:           string;
}

// ── Core fetch functions ───────────────────────────────────────────────────────

/** Strip chain prefix: "cfx_0xabc..." → "0xabc..." */
function normalizeAddress(id: string): string {
  const idx = id.indexOf('_0x');
  return idx >= 0 ? id.slice(idx + 1) : id;
}

async function fetchTopPools(chain: string, page: number): Promise<GtPool[]> {
  const data = await gtFetch(
    `/networks/${chain}/pools?page=${page}&sort=h24_volume_usd_desc`
  ) as { data: GtPool[] };
  return data.data ?? [];
}

async function _fetchPool(chain: string, poolAddress: string): Promise<GtPool> {
  const data = await gtFetch(`/networks/${chain}/pools/${poolAddress}`) as {
    data: GtPool;
  };
  return data.data;
}

async function fetchPoolsMulti(chain: string, poolAddresses: string[]): Promise<GtPool[]> {
  if (poolAddresses.length === 0) return [];
  const data = await gtFetch(`/networks/${chain}/pools/multi/${poolAddresses.join(',')}`) as {
    data: GtPool[];
  };
  return data.data ?? [];
}

async function fetchTokenMeta(chain: string, address: string): Promise<GtTokenAttributes> {
  const data = await gtFetch(`/networks/${chain}/tokens/${address}`) as {
    data: { attributes: GtTokenAttributes };
  };
  return data.data.attributes;
}

async function fetchOhlcv(chain: string, poolAddress: string, agg: number, limitCandles: number, quoteMode = false): Promise<Candle[]> {
  // Each minute candle = 1 minute; aggregate=5 → 5-min candles
  const limit = Math.min(limitCandles, 1000);
  const token = quoteMode ? 'quote' : 'base';
  const data = await gtFetch(
    `/networks/${chain}/pools/${poolAddress}/ohlcv/minute?aggregate=${agg}&limit=${limit}&currency=usd&token=${token}`
  ) as { data: { attributes: { ohlcv_list: [number, number, number, number, number, number][] } } };

  const raw = data.data.attributes.ohlcv_list ?? [];
  // API returns newest-first → reverse to oldest-first
  return raw.reverse().map(([timestamp, open, high, low, close, volume]) => ({
    timestamp, open, high, low, close, volume,
  }));
}

async function downloadIcon(
  imageUrl: string,
  chainId:  number,
  address:  string,
  cacheDir: string,
): Promise<boolean> {
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) return false;
    const buffer = await resp.arrayBuffer();
    const dir = path.join(cacheDir, '..', 'assets', 'tokens', String(chainId));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${address.toLowerCase()}.png`),
      Buffer.from(buffer),
    );
    return true;
  } catch {
    return false;
  }
}

// ── Top-token selection ────────────────────────────────────────────────────────

interface PoolSelection {
  pool:       GtPool;
  baseToken:  string;
  /** When true, this is an inverted pool (e.g. WCFX/TOKEN) — use quote-token price + candles */
  quoteMode?: boolean;
}

function normalizeSelection(selection: TokenSourceSelection): TokenSourceSelection {
  return {
    tokenAddress: normalizeAddress(selection.tokenAddress).toLowerCase(),
    poolAddress: normalizeAddress(selection.poolAddress).toLowerCase(),
    quoteMode: !!selection.quoteMode,
  };
}

function buildSelectionKey(selections: TokenSourceSelection[]): string {
  return selections
    .map(normalizeSelection)
    .sort((left, right) => {
      const poolCompare = left.poolAddress.localeCompare(right.poolAddress);
      if (poolCompare !== 0) return poolCompare;
      const tokenCompare = left.tokenAddress.localeCompare(right.tokenAddress);
      if (tokenCompare !== 0) return tokenCompare;
      return Number(left.quoteMode) - Number(right.quoteMode);
    })
    .map((selection) => `${selection.poolAddress}:${selection.tokenAddress}:${selection.quoteMode ? 'quote' : 'base'}`)
    .join('|');
}

function writeCache(cache: FeedCache, cacheDir: string): void {
  const filename = path.join(cacheDir, `${cache.chainId}-${cache.fetchedAt}.json`);
  fs.writeFileSync(filename, JSON.stringify(cache, null, 2));
}

function loadMatchingCache(
  chainId: number,
  selectionKey: string,
  maxAgeMs: number,
  cacheDir = '.feeds',
): FeedCache | null {
  const files = listCacheFiles(chainId, cacheDir).slice().reverse();
  for (const file of files) {
    const cache = JSON.parse(fs.readFileSync(file, 'utf-8')) as FeedCache;
    if (cache.selectionKey !== selectionKey) continue;
    if (Date.now() - cache.fetchedAt >= maxAgeMs) continue;
    return cache;
  }
  return null;
}

async function selectTopTokens(
  chain:     string,
  count:     number,
  skipStables: boolean,
  interReqMs:  number,
): Promise<{ selections: PoolSelection[]; wcfxPriceUsd?: number }> {
  // Map token address → best (highest-liquidity) candidate seen so far.
  // A token may appear in multiple pools (e.g. ETH/USDT + WCFX/ETH);
  // always keep the one with the highest reserve_in_usd.
  const best = new Map<string, PoolSelection>();
  let page = 1;
  let wcfxPriceUsd: number | undefined;

  const minCandidates = count * 3;
  const maxPages = 10;

  while (best.size < minCandidates && page <= maxPages) {
    await sleep(interReqMs);
    const pools = await fetchTopPools(chain, page++);
    if (!pools.length) break;

    for (const pool of pools) {
      const baseAddr  = normalizeAddress(pool.relationships.base_token.data.id).toLowerCase();
      const quoteAddr = normalizeAddress(pool.relationships.quote_token.data.id).toLowerCase();
      const poolLiq   = parseFloat(pool.attributes.reserve_in_usd) || 0;

      if (isNativeToken(baseAddr)) {
        // Capture WCFX price from base_token_price_usd of this WCFX/TOKEN pool
        if (!wcfxPriceUsd) {
          const p = parseFloat(pool.attributes.base_token_price_usd);
          if (Number.isFinite(p) && p > 0) wcfxPriceUsd = p;
        }
        // The quote token (e.g. PPI in WCFX/PPI) may be a valid mirror target
        if (!isStablecoin(quoteAddr) && !isNativeToken(quoteAddr)) {
          const existing = best.get(quoteAddr);
          const existingLiq = existing ? parseFloat(existing.pool.attributes.reserve_in_usd) || 0 : 0;
          if (!existing || poolLiq > existingLiq) {
            best.set(quoteAddr, { pool, baseToken: quoteAddr, quoteMode: true });
          }
        }
        continue;
      }

      // Opportunistically capture WCFX price from TOKEN/WCFX pool's quote_token_price_usd
      if (!wcfxPriceUsd && isNativeToken(quoteAddr)) {
        const p = parseFloat(pool.attributes.quote_token_price_usd);
        if (Number.isFinite(p) && p > 0) wcfxPriceUsd = p;
      }

      if (skipStables && isStablecoin(baseAddr)) continue;

      // Keep this pool only if it's the best we've seen for this token
      const existing = best.get(baseAddr);
      const existingLiq = existing ? parseFloat(existing.pool.attributes.reserve_in_usd) || 0 : 0;
      if (!existing || poolLiq > existingLiq) {
        best.set(baseAddr, { pool, baseToken: baseAddr });
      }
    }
  }

  // Sort by liquidity (reserve_in_usd) descending — best pairs first
  const candidates = [...best.values()];
  candidates.sort((a, b) => {
    const aLiq = parseFloat(a.pool.attributes.reserve_in_usd) || 0;
    const bLiq = parseFloat(b.pool.attributes.reserve_in_usd) || 0;
    return bLiq - aLiq;
  });

  return { selections: candidates.slice(0, count), wcfxPriceUsd };
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * Fetch top tokens + OHLCV candles from GeckoTerminal and write to FeedCache on disk.
 * This is the only function that makes outbound HTTP calls.
 */
export async function fetchAndCache(
  chainId: number,
  opts:    Partial<FeedFetcherConfig> = {},
): Promise<FeedCache> {
  const cfg: FeedFetcherConfig = { ...DEFAULT_CONFIG, chainId, ...opts };

  const chain = chainIdToGeckoSlug(chainId);
  if (!chain) throw new Error(`No GeckoTerminal slug for chainId ${chainId}`);

  const limitCandles = Math.ceil((cfg.historyHours * 60) / cfg.candleAgg);

  fs.mkdirSync(cfg.cacheDir, { recursive: true });

  const { selections, wcfxPriceUsd } = await selectTopTokens(chain, cfg.tokenCount, cfg.skipStables, cfg.interReqMs);

  const tokens: TokenFeedData[] = [];

  for (const { pool, baseToken, quoteMode = false } of selections) {
    await sleep(cfg.interReqMs);

    // Token metadata — baseToken is always the token we want (quote-side address in quoteMode)
    let meta: GtTokenAttributes;
    try {
      meta = await fetchTokenMeta(chain, baseToken);
      await sleep(cfg.interReqMs);
    } catch {
      // Fallback to pool name-derived metadata
      const parts = pool.attributes.name.split('/').map(s => s.trim());
      const symbol = quoteMode ? parts[1] ?? parts[0] : parts[0];
      meta = { symbol, name: symbol, decimals: 18 };
    }

    // OHLCV candles — use token=quote for inverted (WCFX/TOKEN) pools
    let candles: VWAPPoint[] = [];
    try {
      const raw = await fetchOhlcv(chain, pool.attributes.address, cfg.candleAgg, limitCandles, quoteMode);
      candles = computeVWAP(raw);
      await sleep(cfg.interReqMs);
    } catch {
      // Non-fatal — token will be seeded at spot price with no simulation candles
    }

    // Icon download
    let iconCached = false;
    if (cfg.includeIcons && meta.image_url) {
      iconCached = await downloadIcon(meta.image_url, chainId, baseToken, cfg.cacheDir);
      await sleep(cfg.interReqMs);
    }

    // Price: base_token_price_usd for normal pools; quote_token_price_usd for inverted ones
    const priceUsd = quoteMode
      ? parseFloat(pool.attributes.quote_token_price_usd) || 0
      : parseFloat(pool.attributes.base_token_price_usd) || 0;

    tokens.push({
      realAddress:  baseToken,
      poolAddress:  pool.attributes.address,
      symbol:       meta.symbol,
      name:         meta.name,
      decimals:     meta.decimals ?? 18,
      coingeckoId:  meta.coingecko_coin_id,
      iconCached,
      priceUsd,
      reserveUsd:   parseFloat(pool.attributes.reserve_in_usd) || 0,
      volume24h:    parseFloat(pool.attributes.volume_usd.h24) || 0,
      candles,
    });
  }

  const cache: FeedCache = {
    version:   '1.0',
    chainId,
    chain,
    fetchedAt: Date.now(),
    delayMs:   cfg.delayMinutes * 60 * 1000,
    wcfxPriceUsd,
    tokens,
  };

  writeCache(cache, cfg.cacheDir);

  return cache;
}

export async function fetchAndCacheFromTokenSources(
  chainId: number,
  selections: TokenSourceSelection[],
  opts: Partial<FeedFetcherConfig> = {},
): Promise<FeedCache> {
  const cfg: FeedFetcherConfig = { ...DEFAULT_CONFIG, chainId, ...opts };

  const chain = chainIdToGeckoSlug(chainId);
  if (!chain) throw new Error(`No GeckoTerminal slug for chainId ${chainId}`);

  const normalizedSelections = selections.map(normalizeSelection);
  if (normalizedSelections.length === 0) {
    throw new Error('No token source selections provided.');
  }

  const limitCandles = Math.ceil((cfg.historyHours * 60) / cfg.candleAgg);
  fs.mkdirSync(cfg.cacheDir, { recursive: true });

  const tokens: TokenFeedData[] = [];
  let wcfxPriceUsd: number | undefined;

  const uniquePoolAddresses = [...new Set(normalizedSelections.map((selection) => selection.poolAddress))];
  const poolsByAddress = new Map<string, GtPool>();

  for (let index = 0; index < uniquePoolAddresses.length; index += 20) {
    const batch = uniquePoolAddresses.slice(index, index + 20);
    await sleep(cfg.interReqMs);
    const pools = await fetchPoolsMulti(chain, batch);
    for (const pool of pools) {
      poolsByAddress.set(normalizeAddress(pool.attributes.address).toLowerCase(), pool);
    }
  }

  for (const selection of normalizedSelections) {
    const pool = poolsByAddress.get(selection.poolAddress);
    if (!pool) {
      throw new Error(`Pool ${selection.poolAddress} was not returned by GeckoTerminal multi-pool snapshot.`);
    }

    let meta: GtTokenAttributes;
    try {
      meta = await fetchTokenMeta(chain, selection.tokenAddress);
      await sleep(cfg.interReqMs);
    } catch {
      const parts = pool.attributes.name.split('/').map(s => s.trim());
      const symbol = selection.quoteMode ? parts[1] ?? parts[0] : parts[0];
      meta = { symbol, name: symbol, decimals: 18 };
    }

    let candles: VWAPPoint[] = [];
    try {
      const raw = await fetchOhlcv(chain, pool.attributes.address, cfg.candleAgg, limitCandles, selection.quoteMode);
      candles = computeVWAP(raw);
      await sleep(cfg.interReqMs);
    } catch {
      // Non-fatal — token will still be seeded at spot price.
    }

    let iconCached = false;
    if (cfg.includeIcons && meta.image_url) {
      iconCached = await downloadIcon(meta.image_url, chainId, selection.tokenAddress, cfg.cacheDir);
      await sleep(cfg.interReqMs);
    }

    const baseAddr = normalizeAddress(pool.relationships.base_token.data.id).toLowerCase();
    const quoteAddr = normalizeAddress(pool.relationships.quote_token.data.id).toLowerCase();
    if (!wcfxPriceUsd) {
      if (isNativeToken(baseAddr)) {
        const price = parseFloat(pool.attributes.base_token_price_usd);
        if (Number.isFinite(price) && price > 0) wcfxPriceUsd = price;
      } else if (isNativeToken(quoteAddr)) {
        const price = parseFloat(pool.attributes.quote_token_price_usd);
        if (Number.isFinite(price) && price > 0) wcfxPriceUsd = price;
      }
    }

    tokens.push({
      realAddress: selection.tokenAddress,
      poolAddress: normalizeAddress(pool.attributes.address).toLowerCase(),
      symbol: meta.symbol,
      name: meta.name,
      decimals: meta.decimals ?? 18,
      coingeckoId: meta.coingecko_coin_id,
      iconCached,
      priceUsd: selection.quoteMode
        ? parseFloat(pool.attributes.quote_token_price_usd) || 0
        : parseFloat(pool.attributes.base_token_price_usd) || 0,
      reserveUsd: parseFloat(pool.attributes.reserve_in_usd) || 0,
      volume24h: parseFloat(pool.attributes.volume_usd.h24) || 0,
      candles,
    });
  }

  const cache: FeedCache = {
    version: '1.0',
    chainId,
    chain,
    fetchedAt: Date.now(),
    delayMs: cfg.delayMinutes * 60 * 1000,
    selectionKey: buildSelectionKey(normalizedSelections),
    wcfxPriceUsd,
    tokens,
  };

  writeCache(cache, cfg.cacheDir);
  return cache;
}

// ── Cache management ───────────────────────────────────────────────────────────

function listCacheFiles(chainId: number, cacheDir = '.feeds'): string[] {
  if (!fs.existsSync(cacheDir)) return [];
  return fs
    .readdirSync(cacheDir)
    .filter(f => f.startsWith(`${chainId}-`) && f.endsWith('.json'))
    .sort() // lexicographic = chronological since timestamps are ms
    .map(f => path.join(cacheDir, f));
}

/**
 * Load the most recent FeedCache for a chain. Throws if none exists.
 */
export function loadCache(chainId: number, cacheDir = '.feeds'): FeedCache {
  const files = listCacheFiles(chainId, cacheDir);
  if (!files.length) {
    throw new Error(
      `No feed cache for chainId ${chainId} in ${cacheDir}. ` +
      'Run fetchAndCache() first (requires network access).'
    );
  }
  const latest = files[files.length - 1];
  return JSON.parse(fs.readFileSync(latest, 'utf-8')) as FeedCache;
}

/**
 * Returns true if a cache file exists and is within maxAgeMs (default: 1 hour).
 */
export function isCacheValid(chainId: number, maxAgeMs = 60 * 60 * 1000, cacheDir = '.feeds'): boolean {
  const files = listCacheFiles(chainId, cacheDir);
  if (!files.length) return false;
  const cache = JSON.parse(fs.readFileSync(files[files.length - 1], 'utf-8')) as FeedCache;
  return Date.now() - cache.fetchedAt < maxAgeMs;
}

/**
 * Fetch fresh data only if cache is stale — otherwise load existing.
 */
export async function refreshCache(
  chainId: number,
  opts:    Partial<FeedFetcherConfig> = {},
  maxAgeMs = 60 * 60 * 1000,
): Promise<FeedCache> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CONFIG.cacheDir;
  if (isCacheValid(chainId, maxAgeMs, cacheDir)) {
    return loadCache(chainId, cacheDir);
  }
  return fetchAndCache(chainId, opts);
}

export async function refreshSelectedTokenSourcesCache(
  chainId: number,
  selections: TokenSourceSelection[],
  opts: Partial<FeedFetcherConfig> = {},
  maxAgeMs = 60 * 60 * 1000,
): Promise<FeedCache> {
  const cacheDir = opts.cacheDir ?? DEFAULT_CONFIG.cacheDir;
  const selectionKey = buildSelectionKey(selections);
  const cached = loadMatchingCache(chainId, selectionKey, maxAgeMs, cacheDir);
  if (cached) {
    return cached;
  }
  return fetchAndCacheFromTokenSources(chainId, selections, opts);
}

/**
 * List all cache snapshots for a chain (for historical replay).
 */
export function listCacheVersions(chainId: number, cacheDir = '.feeds'): string[] {
  return listCacheFiles(chainId, cacheDir);
}

/**
 * Download icons for cached tokens that are missing them.
 * Call AFTER refreshCache when includeIcons is true but the cache was served
 * from disk (where icons were previously disabled).
 * Updates the cache file and returns count of newly downloaded icons.
 */
export async function ensureIcons(
  cache: FeedCache,
  cacheDir = '.feeds',
  interReqMs = 100,
): Promise<number> {
  const chain = chainIdToGeckoSlug(cache.chainId);
  if (!chain) return 0;

  let count = 0;
  for (const token of cache.tokens) {
    if (token.iconCached) continue;
    try {
      const meta = await fetchTokenMeta(chain, token.realAddress);
      await sleep(interReqMs);
      if (meta.image_url) {
        const ok = await downloadIcon(meta.image_url, cache.chainId, token.realAddress, cacheDir);
        if (ok) {
          token.iconCached = true;
          count++;
        }
        await sleep(interReqMs);
      }
    } catch { /* non-fatal */ }
  }

  // Persist updated iconCached flags to the cache file
  if (count > 0) {
    const files = listCacheFiles(cache.chainId, cacheDir);
    if (files.length > 0) {
      fs.writeFileSync(files[files.length - 1], JSON.stringify(cache, null, 2));
    }
  }
  return count;
}

/**
 * Copy the most recent cache to a test fixtures directory.
 */
export function exportCacheAsFixture(chainId: number, destPath: string, cacheDir = '.feeds'): void {
  const files = listCacheFiles(chainId, cacheDir);
  if (!files.length) throw new Error(`No cache to export for chainId ${chainId}`);
  const src = files[files.length - 1];
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(src, destPath);
}
