import { fetchWcfxPriceViaBackend } from './dex-backend-client.js';

/**
 * Fetch WCFX (CFX) price in USD.
 * 0th try: Devkit backend pricing endpoint (canonical owner for DEX runtime data).
 * 1st try: CoinGecko simple price API (no key, reliable for native token).
 * 2nd try: GeckoTerminal token endpoint.
 * Fallback: 0.05 (approximate CFX price as of early 2026).
 */
export async function fetchWcfxPrice(devkitUrl = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748'): Promise<number> {
  const backendPrice = await fetchWcfxPriceViaBackend(devkitUrl);
  if (backendPrice != null) return backendPrice;

  // Try CoinGecko simple price (no API key needed for basic use)
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=conflux-token&vs_currencies=usd',
      { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) },
    );
    const json = await res.json() as { 'conflux-token'?: { usd?: number } };
    const p = json['conflux-token']?.usd ?? 0;
    if (Number.isFinite(p) && p > 0) return p;
  } catch {
    // try next source
  }

  // Fallback: GeckoTerminal token endpoint
  const WCFX_MAINNET = '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b';
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/cfx/tokens/${WCFX_MAINNET}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    const json = await res.json() as { data?: { attributes?: { price_usd?: string } } };
    const p = parseFloat(json?.data?.attributes?.price_usd ?? '');
    if (Number.isFinite(p) && p > 0) return p;
  } catch {
    // fall through
  }

  return 0.05;
}
