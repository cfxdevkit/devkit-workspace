import { useEffect, useMemo, useState } from 'react';
import {
  fetchKnownTokenCatalogFile,
  fetchPoolImportPresets,
  isStablecoinPool,
  savePoolImportPresets,
  type KnownPoolEntry,
} from '../lib/knownTokens';
import { Button, SectionHeader, SelectableListItem, StatusBanner } from '@cfxdevkit/ui-shared';

function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function getSuggestedPoolSelection(pools: KnownPoolEntry[], limit = 5): string[] {
  return pools
    .filter((pool) => pool.isWcfxPair && !isStablecoinPool(pool))
    .sort((left, right) => {
      if (left.reserveUsd !== right.reserveUsd) return right.reserveUsd - left.reserveUsd;
      return right.volume24h - left.volume24h;
    })
    .slice(0, limit)
    .map((pool) => pool.address.toLowerCase());
}

export function PoolImportManager() {
  const [pools, setPools] = useState<KnownPoolEntry[]>([]);
  const [selectedPools, setSelectedPools] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([fetchKnownTokenCatalogFile(), fetchPoolImportPresets()])
      .then(([catalog, presets]) => {
        if (cancelled) return;
        const nextPools = (catalog?.pools ?? [])
          .filter((pool) => !isStablecoinPool(pool))
          .sort((left, right) => right.reserveUsd - left.reserveUsd);
        const presetSelection = (presets?.selectedPoolAddresses ?? []).map((entry) => entry.toLowerCase());
        setPools(nextPools);
        setSelectedPools(new Set(presetSelection.length > 0 ? presetSelection : getSuggestedPoolSelection(nextPools)));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(error instanceof Error ? error.message : 'Failed to load pool catalog');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPools = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return pools;
    return pools.filter((pool) => (
      pool.label.toLowerCase().includes(query)
      || pool.baseToken.symbol.toLowerCase().includes(query)
      || pool.quoteToken.symbol.toLowerCase().includes(query)
      || pool.address.includes(query)
    ));
  }, [pools, search]);

  const selectedTokenCount = useMemo(() => {
    const tokens = new Set<string>();
    for (const pool of pools) {
      if (!selectedPools.has(pool.address.toLowerCase())) continue;
      if (!pool.isWcfxPair) tokens.add(pool.baseToken.address.toLowerCase());
      if (!pool.isWcfxPair) tokens.add(pool.quoteToken.address.toLowerCase());
      if (pool.isWcfxPair) {
        const imported = pool.baseToken.symbol === 'WCFX' ? pool.quoteToken.address : pool.baseToken.address;
        tokens.add(imported.toLowerCase());
      }
    }
    return tokens.size;
  }, [pools, selectedPools]);

  const togglePool = (address: string) => {
    const normalized = address.toLowerCase();
    setSelectedPools((current) => {
      const next = new Set(current);
      if (next.has(normalized)) next.delete(normalized);
      else next.add(normalized);
      return next;
    });
  };

  const saveSelection = async () => {
    setSaving(true);
    setStatus('Saving pool preset...');
    try {
      const saved = await savePoolImportPresets([...selectedPools].sort());
      setSelectedPools(new Set(saved.selectedPoolAddresses.map((entry) => entry.toLowerCase())));
      setStatus(`Saved ${saved.selectedPoolAddresses.length} selected pools`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save pool preset');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden">
      <div className="absolute top-0 right-0 -mr-24 -mt-24 h-72 w-72 rounded-full bg-accent/5 blur-[100px] pointer-events-none opacity-25" />

      <SectionHeader
        className="sm:items-end"
        title="Import Pools"
        description="Choose the GeckoTerminal source pools that drive local DEX seeding."
        right={(
          <div className="text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/30 italic">
            {selectedPools.size} pools selected • {selectedTokenCount} import tokens
          </div>
        )}
      />

      <div className="relative grid gap-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search pool label, token, or address"
            className="w-full rounded-2xl border border-white/10 bg-bg-primary/70 px-4 py-3 text-sm text-white outline-none transition focus:border-accent/40"
          />
          <Button variant="secondary" onClick={() => setSelectedPools(new Set(getSuggestedPoolSelection(pools)))}>
            Reset Suggested
          </Button>
          <Button onClick={() => void saveSelection()} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save Preset'}
          </Button>
        </div>

        <div className="grid gap-3 max-h-[560px] overflow-auto pr-1">
          {filteredPools.map((pool) => {
            const active = selectedPools.has(pool.address.toLowerCase());
            return (
              <SelectableListItem
                key={pool.address}
                active={active}
                onClick={() => togglePool(pool.address)}
                title={pool.label}
                subtitle={pool.address}
                subtitleClassName="break-all whitespace-normal overflow-visible text-ellipsis-clip"
                end={(
                  <div className="flex flex-wrap justify-end gap-2 text-[8px] font-black uppercase tracking-[0.18em] text-text-secondary/40">
                    <span className="rounded-full border border-white/10 px-2 py-1">{formatUsd(pool.reserveUsd)} liq</span>
                    <span className="rounded-full border border-white/10 px-2 py-1">{formatUsd(pool.volume24h)} 24h</span>
                    {pool.isWcfxPair ? <span className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-accent/80">WCFX</span> : null}
                  </div>
                )}
                className="px-4 py-4"
              />
            );
          })}

          {!loading && filteredPools.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary/35">
              No pools matched
            </div>
          )}
        </div>

        {status && <StatusBanner message={status} tone={status.toLowerCase().includes('fail') || status.toLowerCase().includes('error') ? 'error' : 'accent'} className="rounded-2xl bg-bg-primary/35 text-text-secondary/45" textClassName="text-[10px] tracking-[0.16em]" />}
      </div>
    </div>
  );
}