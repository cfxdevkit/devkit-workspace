import type { TranslationTable } from '@cfxdevkit/shared';
import type { TrackedContract } from '../../contracts.js';
import type { V2Manifest } from './dex-types.js';

export function createDexStateStore(params: {
  devkitUrl: string;
  defaultRpcUrl: string;
  defaultChainId: number;
  registrySuffix: string;
  readTrackedDexContracts: (chainId: number) => Promise<TrackedContract[]>;
  buildManifestFromTrackedContracts: (contracts: TrackedContract[], rpcUrl: string, chainId: number, registrySuffix: string) => V2Manifest | null;
  buildTranslationTableFromTrackedContracts: (contracts: TrackedContract[], localWeth: string, chainId: number, registrySuffix: string) => TranslationTable | null;
  verifyDeployment: (manifest: V2Manifest) => Promise<{ ok: boolean; pairCount: number; error?: string }>;
}) {
  const {
    devkitUrl,
    defaultRpcUrl,
    defaultChainId,
    registrySuffix,
    readTrackedDexContracts,
    buildManifestFromTrackedContracts,
    buildTranslationTableFromTrackedContracts,
    verifyDeployment,
  } = params;

  let cachedManifest: V2Manifest | null = null;
  let cachedTranslationTable: TranslationTable | null = null;

  async function postManifest(manifest: V2Manifest): Promise<void> {
    cachedManifest = manifest;
    try {
      await fetch(`${devkitUrl}/api/dex/manifest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // Backend may not be running.
    }
  }

  async function postTranslationTable(table: TranslationTable): Promise<void> {
    cachedTranslationTable = table;
    try {
      await fetch(`${devkitUrl}/api/dex/translation-table`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(table),
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      // Backend may not be running.
    }
  }

  async function readManifest(
    rpcUrl = defaultRpcUrl,
    chainId = defaultChainId,
  ): Promise<V2Manifest | null> {
    if (cachedManifest) {
      const verify = await verifyDeployment(cachedManifest).catch(() => ({ ok: false, pairCount: 0 }));
      if (verify.ok) return cachedManifest;
      cachedManifest = null;
    }

    try {
      const r = await fetch(`${devkitUrl}/api/dex/manifest`, { signal: AbortSignal.timeout(5_000) });
      if (r.ok) {
        const manifest = await r.json() as V2Manifest;
        const verify = await verifyDeployment(manifest).catch(() => ({ ok: false, pairCount: 0 }));
        if (verify.ok) {
          cachedManifest = manifest;
          return cachedManifest;
        }
      }
    } catch {
      // Backend may not be running.
    }

    const trackedContracts = await readTrackedDexContracts(chainId);
    const reconstructed = buildManifestFromTrackedContracts(trackedContracts, rpcUrl, chainId, registrySuffix);
    if (!reconstructed) return null;

    const verify = await verifyDeployment(reconstructed).catch(() => ({ ok: false, pairCount: 0 }));
    if (!verify.ok) return null;

    await postManifest(reconstructed);
    return reconstructed;
  }

  async function readTranslationTable(
    localWETH?: string,
    chainId = defaultChainId,
  ): Promise<TranslationTable | null> {
    if (cachedTranslationTable) return cachedTranslationTable;

    try {
      const r = await fetch(`${devkitUrl}/api/dex/translation-table`, { signal: AbortSignal.timeout(5_000) });
      if (r.ok) {
        cachedTranslationTable = await r.json() as TranslationTable;
        return cachedTranslationTable;
      }
    } catch {
      // Backend may not be running.
    }

    const trackedContracts = await readTrackedDexContracts(chainId);
    const resolvedWeth = localWETH ?? (await readManifest(defaultRpcUrl, chainId))?.contracts.weth9;
    if (!resolvedWeth) return null;

    const reconstructed = buildTranslationTableFromTrackedContracts(trackedContracts, resolvedWeth, chainId, registrySuffix);
    if (!reconstructed) return null;

    await postTranslationTable(reconstructed);
    return reconstructed;
  }

  function clearCache(): void {
    cachedManifest = null;
    cachedTranslationTable = null;
  }

  async function resetRemoteState(): Promise<void> {
    try {
      await fetch(`${devkitUrl}/api/dex/state`, { method: 'DELETE', signal: AbortSignal.timeout(3_000) });
    } catch {
      // Backend may not be running.
    }
  }

  return {
    postManifest,
    postTranslationTable,
    readManifest,
    readTranslationTable,
    clearCache,
    resetRemoteState,
  };
}
