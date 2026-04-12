import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isNativeToken,
  isStablecoin,
  type TokenSourceSelection,
} from '@cfxdevkit/shared';
import type {
  KnownPoolEntry,
  KnownTokenCatalog,
  PoolImportPresetFile,
} from './dex-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function normalizeCatalogAddress(address: string): string {
  return address.toLowerCase();
}

function resolveWorkspaceFile(...relativePaths: string[]): string | null {
  const candidates = relativePaths.flatMap((relativePath) => [
    resolve(process.cwd(), relativePath),
    resolve(__dirname, '../../../', relativePath),
  ]);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function readWorkspaceJsonFile<T>(...relativePaths: string[]): T | null {
  const filePath = resolveWorkspaceFile(...relativePaths);
  if (!filePath) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export function loadKnownTokenCatalog(): KnownTokenCatalog {
  return readWorkspaceJsonFile<KnownTokenCatalog>(
    'dex-ui/public/known-tokens.json',
    'dapp/public/known-tokens.json',
  ) ?? {};
}

export function loadPoolImportPresets(): PoolImportPresetFile {
  return readWorkspaceJsonFile<PoolImportPresetFile>(
    'dex-ui/public/pool-import-presets.json',
    'dapp/public/pool-import-presets.json',
  ) ?? {};
}

function getSuggestedPoolAddresses(catalog: KnownTokenCatalog, limit = 5): string[] {
  return (catalog.pools ?? [])
    .filter((pool) => pool.isWcfxPair && !isStablecoin(pool.baseToken.address) && !isStablecoin(pool.quoteToken.address))
    .sort((left, right) => {
      if (left.reserveUsd !== right.reserveUsd) return right.reserveUsd - left.reserveUsd;
      return right.volume24h - left.volume24h;
    })
    .slice(0, limit)
    .map((pool) => normalizeCatalogAddress(pool.address));
}

export function resolveSelectedPoolAddresses(input: unknown, presets: PoolImportPresetFile, catalog: KnownTokenCatalog): string[] {
  const requested = Array.isArray(input) ? input : [];
  const presetAddresses = (presets.selectedPoolAddresses ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0);
  const addresses = requested.length > 0
    ? requested
    : (presetAddresses.length > 0 ? presetAddresses : getSuggestedPoolAddresses(catalog));
  return [...new Set(
    addresses
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map(normalizeCatalogAddress)
  )];
}

export function buildTokenSourceSelections(
  catalog: KnownTokenCatalog,
  selectedPoolAddresses: string[],
): { selections: TokenSourceSelection[]; selectedPools: KnownPoolEntry[]; warnings: string[] } {
  const selectionOrder = new Map(selectedPoolAddresses.map((address, index) => [normalizeCatalogAddress(address), index]));
  const selectedSet = new Set(selectionOrder.keys());
  const poolsByAddress = new Map((catalog.pools ?? []).map((pool) => [normalizeCatalogAddress(pool.address), pool]));

  const selections: TokenSourceSelection[] = [];
  const warnings: string[] = [];
  const usedPoolAddresses = new Set<string>();

  for (const token of catalog.tokens ?? []) {
    const tokenAddress = normalizeCatalogAddress(token.address);
    if (isNativeToken(tokenAddress) || isStablecoin(tokenAddress)) continue;

    const matches = (token.candidatePools ?? [])
      .filter((pool) => selectedSet.has(normalizeCatalogAddress(pool.poolAddress)))
      .sort((left, right) => {
        const leftIndex = selectionOrder.get(normalizeCatalogAddress(left.poolAddress)) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = selectionOrder.get(normalizeCatalogAddress(right.poolAddress)) ?? Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex;
      });

    if (matches.length === 0) continue;

    const chosen = matches[0];
    usedPoolAddresses.add(normalizeCatalogAddress(chosen.poolAddress));

    if (matches.length > 1) {
      warnings.push(
        `Token ${token.symbol} matched ${matches.length} selected source pools; using ${chosen.label}.`,
      );
    }

    selections.push({
      tokenAddress,
      poolAddress: normalizeCatalogAddress(chosen.poolAddress),
      quoteMode: chosen.tokenSide === 'quote',
    });
  }

  const selectedPools = selectedPoolAddresses
    .map((address) => poolsByAddress.get(address))
    .filter((pool): pool is KnownPoolEntry => !!pool);

  for (const poolAddress of selectedSet) {
    if (!usedPoolAddresses.has(poolAddress)) {
      const pool = poolsByAddress.get(poolAddress);
      warnings.push(`Selected pool ${pool?.label ?? poolAddress} does not add a new non-stable token import.`);
    }
  }

  return { selections, selectedPools, warnings };
}
