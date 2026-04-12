export interface KnownPoolTokenDescriptor {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
}

export interface KnownPoolEntry {
  address: string;
  label: string;
  baseToken: KnownPoolTokenDescriptor;
  quoteToken: KnownPoolTokenDescriptor;
  reserveUsd: number;
  volume24h: number;
  baseTokenPriceUsd?: number | null;
  quoteTokenPriceUsd?: number | null;
  isWcfxPair: boolean;
}

export interface KnownTokenPoolRef {
  poolAddress: string;
  label: string;
  tokenSide: 'base' | 'quote';
  token: KnownPoolTokenDescriptor;
  counterparty: KnownPoolTokenDescriptor;
  reserveUsd: number;
  volume24h: number;
  tokenPriceUsd?: number | null;
  isWcfxPair: boolean;
}

export interface KnownTokenEntry {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  iconUrl?: string | null;
  bestPool?: KnownTokenPoolRef | null;
  wcfxPool?: KnownTokenPoolRef | null;
  candidatePools?: KnownTokenPoolRef[];
}

export interface KnownTokenCatalog {
  version?: number;
  chainId?: number;
  generatedAt?: string;
  pools?: KnownPoolEntry[];
  tokens?: KnownTokenEntry[];
}

export interface PoolImportPresetFile {
  version: number;
  chainId: number;
  updatedAt: string;
  selectedPoolAddresses: string[];
}

export interface TokenIconUploadResult {
  iconUrl: string;
}

export interface TokenIconOverrideEntry {
  address: string;
  iconUrl: string;
}

interface TokenIconOverrideFile {
  icons?: TokenIconOverrideEntry[];
}

const STABLECOIN_ADDRESSES = new Set([
  '0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff',
  '0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e',
  '0xfe97e85d13abd9c1c33384e796f10b73905637ce',
  '0x6963efed0ab40f6c3d7bda44a05dcf1437c44372',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '0xdac17f958d2ee523a2206206994597c13d831ec7',
  '0x6b175474e89094c44da98b954eedeac495271d0f',
]);

export function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

export function isStablecoinAddress(address: string): boolean {
  return STABLECOIN_ADDRESSES.has(normalizeAddress(address));
}

export function isStablecoinPool(pool: KnownPoolEntry): boolean {
  return isStablecoinAddress(pool.baseToken.address) || isStablecoinAddress(pool.quoteToken.address);
}

export async function fetchKnownTokenCatalog(): Promise<Map<string, KnownTokenEntry>> {
  const map = new Map<string, KnownTokenEntry>();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}known-tokens.json?v=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return map;

    const data = await response.json() as KnownTokenCatalog;
    for (const token of data.tokens ?? []) {
      map.set(normalizeAddress(token.address), token);
    }

    const overrides = await fetchTokenIconOverrides();
    applyTokenIconOverrides(map, overrides);
  } catch {
    // Ignore optional static catalog failures.
  }
  return map;
}

export async function fetchKnownTokenCatalogFile(): Promise<KnownTokenCatalog | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}known-tokens.json?v=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return null;
    return await response.json() as KnownTokenCatalog;
  } catch {
    return null;
  }
}

export async function fetchTokenIconOverrides(): Promise<Map<string, TokenIconOverrideEntry>> {
  const map = new Map<string, TokenIconOverrideEntry>();
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/dex/token-icon-overrides?v=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return map;

    const data = await response.json() as TokenIconOverrideFile;
    for (const entry of data.icons ?? []) {
      if (!entry?.address || !entry?.iconUrl) continue;
      map.set(normalizeAddress(entry.address), {
        address: normalizeAddress(entry.address),
        iconUrl: entry.iconUrl,
      });
    }
  } catch {
    // Ignore optional override file failures.
  }
  return map;
}

export async function fetchPoolImportPresets(): Promise<PoolImportPresetFile | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}api/dex/pool-import-presets?v=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      const fallbackResponse = await fetch(`${import.meta.env.BASE_URL}pool-import-presets.json?v=${Date.now()}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(3000),
      });
      if (!fallbackResponse.ok) return null;
      return await fallbackResponse.json() as PoolImportPresetFile;
    }
    return await response.json() as PoolImportPresetFile;
  } catch {
    return null;
  }
}

export async function savePoolImportPresets(selectedPoolAddresses: string[]): Promise<PoolImportPresetFile> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/dex/pool-import-presets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selectedPoolAddresses }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to save pool import presets');
  }
  return await response.json() as PoolImportPresetFile;
}

export function applyTokenIconOverrides(
  knownTokens: Map<string, KnownTokenEntry>,
  overrides: Map<string, TokenIconOverrideEntry>,
): void {
  for (const [address, override] of overrides.entries()) {
    const existing = knownTokens.get(address);
    if (!existing) continue;
    knownTokens.set(address, { ...existing, iconUrl: override.iconUrl });
  }
}

export async function saveTokenIconOverride(address: string, iconUrl: string | null): Promise<void> {
  const trimmedAddress = normalizeAddress(address);
  const trimmedIconUrl = iconUrl?.trim() ?? '';
  const response = await fetch(`${import.meta.env.BASE_URL}api/dex/token-icon-overrides`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address: trimmedAddress, iconUrl: trimmedIconUrl || null }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to save token icon override');
  }
}

export async function uploadTokenIcon(address: string, file: File): Promise<TokenIconUploadResult> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read icon file'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(file);
  });

  const response = await fetch(`${import.meta.env.BASE_URL}api/dex/token-icon-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: normalizeAddress(address),
      fileName: file.name,
      dataUrl,
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error ?? 'Failed to upload token icon');
  }

  return await response.json() as TokenIconUploadResult;
}

export function resolveKnownToken(
  knownTokens: Map<string, KnownTokenEntry>,
  options: { contractAddress?: string | null; realAddress?: string | null },
): KnownTokenEntry | undefined {
  const realAddress = options.realAddress ? knownTokens.get(normalizeAddress(options.realAddress)) : undefined;
  if (realAddress) return realAddress;
  return options.contractAddress ? knownTokens.get(normalizeAddress(options.contractAddress)) : undefined;
}

export function isEffigyIcon(iconUrl: string | null | undefined): boolean {
  return typeof iconUrl === 'string' && iconUrl.includes('effigy.im');
}
