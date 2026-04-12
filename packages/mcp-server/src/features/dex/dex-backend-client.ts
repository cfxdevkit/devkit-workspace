import type { FeedCache, TokenSourceSelection } from '@cfxdevkit/shared';

export function resolveDexBackendUrl(explicitUrl?: string): string {
  return explicitUrl ?? process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748';
}

export async function fetchWcfxPriceViaBackend(devkitUrl?: string): Promise<number | null> {
  const baseUrl = resolveDexBackendUrl(devkitUrl);
  try {
    const res = await fetch(`${baseUrl}/api/dex/pricing/wcfx-usd`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { usd?: number };
    const price = json.usd ?? 0;
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

export async function refreshSelectedSourcesViaBackend(params: {
  chainId: number;
  tokenSelections: TokenSourceSelection[];
  forceRefresh: boolean;
  maxAgeMs?: number;
  devkitUrl?: string;
}): Promise<FeedCache | null> {
  const {
    chainId,
    tokenSelections,
    forceRefresh,
    maxAgeMs = 30 * 60 * 1000,
    devkitUrl,
  } = params;
  const baseUrl = resolveDexBackendUrl(devkitUrl);

  try {
    const response = await fetch(`${baseUrl}/api/dex/source-pools/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chainId,
        tokenSelections,
        forceRefresh,
        maxAgeMs,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return await response.json() as FeedCache;
  } catch {
    return null;
  }
}

export async function mineViaBackend(blocks: number, devkitUrl?: string): Promise<boolean> {
  const baseUrl = resolveDexBackendUrl(devkitUrl);
  try {
    const response = await fetch(`${baseUrl}/api/mining/mine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fundViaBackend(deployer: string, amount: number, devkitUrl?: string): Promise<boolean> {
  const baseUrl = resolveDexBackendUrl(devkitUrl);
  try {
    const response = await fetch(`${baseUrl}/api/accounts/fund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: deployer, amount: String(amount), chain: 'evm' }),
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
