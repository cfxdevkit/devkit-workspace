import { Router } from 'express';
import {
  refreshSelectedTokenSourcesCache,
  type FeedCache,
  type TokenSourceSelection,
} from '@cfxdevkit/shared';

interface DexManifest {
  deployedAt: string;
  chainId: number;
  rpcUrl: string;
  deployer: string;
  contracts: {
    factory: string;
    weth9: string;
    router02: string;
  };
  initCodeHash: string;
}

interface TranslationTableEntry {
  realAddress: string;
  localAddress: string;
  symbol: string;
  decimals: number;
  iconCached: boolean;
  mirroredAt: number;
}

interface TranslationTable {
  chainId: number;
  localWETH: string;
  updatedAt: number;
  entries: TranslationTableEntry[];
}

interface DexPriceSnapshot {
  usd: number;
  source: 'coingecko' | 'geckoterminal' | 'fallback';
  fetchedAt: number;
}

interface SeedRefreshRequest {
  chainId: number;
  tokenSelections: TokenSourceSelection[];
  forceRefresh?: boolean;
  maxAgeMs?: number;
}

// Canonical in-process DEX runtime state for MCP/backend coordination.
let cachedManifest: DexManifest | null = null;
let cachedTranslationTable: TranslationTable | null = null;
let cachedWcfxUsd: DexPriceSnapshot | null = null;

const PRICE_CACHE_TTL_MS = 30_000;
const PRICE_FALLBACK_USD = 0.05;
const WCFX_MAINNET = '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b';

function getDexUiUrl(): string {
  return process.env.DEX_URL ?? 'http://localhost:8888';
}

async function mirrorToDexUi(path: string, init: RequestInit): Promise<void> {
  try {
    await fetch(`${getDexUiUrl()}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(3_000),
    });
  } catch {
    // DEX UI is optional; backend remains canonical source of truth.
  }
}

async function fetchWcfxPriceFromProviders(): Promise<DexPriceSnapshot> {
  const now = Date.now();
  if (cachedWcfxUsd && now - cachedWcfxUsd.fetchedAt < PRICE_CACHE_TTL_MS) {
    return cachedWcfxUsd;
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=conflux-token&vs_currencies=usd',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) },
    );
    const json = await res.json() as { 'conflux-token'?: { usd?: number } };
    const usd = json['conflux-token']?.usd ?? 0;
    if (Number.isFinite(usd) && usd > 0) {
      cachedWcfxUsd = { usd, source: 'coingecko', fetchedAt: Date.now() };
      return cachedWcfxUsd;
    }
  } catch {
    // fall through to next provider
  }

  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/cfx/tokens/${WCFX_MAINNET}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    const json = await res.json() as { data?: { attributes?: { price_usd?: string } } };
    const usd = parseFloat(json?.data?.attributes?.price_usd ?? '');
    if (Number.isFinite(usd) && usd > 0) {
      cachedWcfxUsd = { usd, source: 'geckoterminal', fetchedAt: Date.now() };
      return cachedWcfxUsd;
    }
  } catch {
    // fall through to deterministic fallback
  }

  cachedWcfxUsd = { usd: PRICE_FALLBACK_USD, source: 'fallback', fetchedAt: Date.now() };
  return cachedWcfxUsd;
}

export function createDexRuntimeRoutes(): Router {
  const router = Router();

  router.post('/source-pools/refresh', async (req, res) => {
    const body = req.body as Partial<SeedRefreshRequest>;
    const chainId = Number(body.chainId ?? 0);
    const tokenSelections = Array.isArray(body.tokenSelections) ? body.tokenSelections : [];
    const forceRefresh = body.forceRefresh === true;
    const maxAgeMs = typeof body.maxAgeMs === 'number' && body.maxAgeMs >= 0
      ? body.maxAgeMs
      : 30 * 60 * 1000;

    if (!Number.isFinite(chainId) || chainId <= 0) {
      res.status(400).json({ error: 'chainId must be a positive number' });
      return;
    }
    if (tokenSelections.length === 0) {
      res.status(400).json({ error: 'tokenSelections must contain at least one selection' });
      return;
    }

    try {
      const feed = await refreshSelectedTokenSourcesCache(
        chainId,
        tokenSelections,
        {
          skipStables: true,
          historyHours: 1,
          includeIcons: false,
        },
        forceRefresh ? 0 : maxAgeMs,
      );
      res.json(feed satisfies FeedCache);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'failed to refresh selected source pools',
      });
    }
  });

  router.get('/pricing/wcfx-usd', async (_req, res) => {
    const price = await fetchWcfxPriceFromProviders();
    res.json(price);
  });

  router.get('/manifest', (_req, res) => {
    if (!cachedManifest) {
      res.status(404).json({ error: 'dex manifest not found' });
      return;
    }
    res.json(cachedManifest);
  });

  router.post('/manifest', async (req, res) => {
    cachedManifest = req.body as DexManifest;
    await mirrorToDexUi('/api/dex/manifest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachedManifest),
    });
    res.json({ ok: true });
  });

  router.get('/translation-table', (_req, res) => {
    if (!cachedTranslationTable) {
      res.status(404).json({ error: 'dex translation table not found' });
      return;
    }
    res.json(cachedTranslationTable);
  });

  router.post('/translation-table', async (req, res) => {
    cachedTranslationTable = req.body as TranslationTable;
    await mirrorToDexUi('/api/dex/translation-table', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cachedTranslationTable),
    });
    res.json({ ok: true });
  });

  router.delete('/state', async (_req, res) => {
    cachedManifest = null;
    cachedTranslationTable = null;
    cachedWcfxUsd = null;
    await mirrorToDexUi('/api/dex/state', { method: 'DELETE' });
    res.json({ ok: true });
  });

  return router;
}
