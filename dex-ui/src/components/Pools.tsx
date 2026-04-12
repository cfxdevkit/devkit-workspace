import { useMemo, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { Button, CopyButton, SectionHeader, StatusBanner } from '@cfxdevkit/ui-shared';
import type { DexState, PoolInfo } from '../hooks/useDex';
import { confluxLocalESpace } from '../chains';
import { ROUTER_ABI } from '../hooks/useDex';

function fmtNum(n: number, maxDec = 8): string {
  if (n === 0) return '0';
  const abs = Math.abs(n);
  const dec = abs >= 1 ? 2 : abs >= 0.01 ? 4 : abs >= 0.0001 ? 6 : maxDec;
  return parseFloat(n.toFixed(dec)).toString();
}

function fmtReserve(raw: bigint, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return fmtNum(n);
}

function TokenBadge({ symbol, address, iconUrl }: { symbol: string; address: string; iconUrl?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 overflow-hidden">
      {iconUrl ? (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/90 p-[2px] shadow-sm">
          <img src={iconUrl} alt="" width={18} height={18} className="h-full w-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
      ) : (
        <div className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-border text-[8px] font-bold uppercase text-text-secondary">{symbol[0]}</div>
      )}
      <span className="truncate text-sm font-black tracking-tight text-white">{symbol}</span>
      <CopyButton copyText={address} title={`${symbol}: ${address}\nClick to copy`} size="md" stopPropagation className="shadow-sm hover:scale-105" />
    </div>
  );
}

export function Pools({ dex }: { dex: DexState }) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [activePool, setActivePool] = useState<string | null>(null);
  const [removePercent, setRemovePercent] = useState(50);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const isWrongChain = isConnected && chainId !== confluxLocalESpace.id;
  const handleSwitchChain = () => {
    switchChain?.({ chainId: confluxLocalESpace.id });
  };

  const activePoolData = useMemo(() => dex.pools.find((pool) => pool.pairAddress === activePool) ?? null, [activePool, dex.pools]);
  const connectedPositions = dex.pools.filter((pool) => pool.userLpBalance > 0n).length;

  const getSharePct = (pool: PoolInfo) => {
    if (pool.totalSupply === 0n) return 0;
    return (Number(pool.userLpBalance) / Number(pool.totalSupply)) * 100;
  };

  const getRemoveEstimates = (pool: PoolInfo, pct: number) => {
    if (pool.userLpBalance === 0n || pool.totalSupply === 0n) {
      return { liquidity: 0n, amount0: 0n, amount1: 0n };
    }
    const liquidity = (pool.userLpBalance * BigInt(Math.round(pct * 100))) / 10000n;
    const amount0 = (pool.reserve0 * liquidity) / pool.totalSupply;
    const amount1 = (pool.reserve1 * liquidity) / pool.totalSupply;
    return { liquidity, amount0, amount1 };
  };

  const handleRemoveLiquidity = async (pool: PoolInfo) => {
    if (!walletClient || !publicClient || !address || !dex.router) {
      setStatus('Syncing Protocol...');
      return;
    }

    const { liquidity, amount0, amount1 } = getRemoveEstimates(pool, removePercent);
    if (liquidity <= 0n) {
      setStatus('Selection Required');
      return;
    }

    setLoading(true);
    setStatus('Preparing protocol exit...');

    try {
      const allowance = (await publicClient.readContract({
        address: pool.pairAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, dex.router],
      })) as bigint;

      if (allowance < liquidity) {
        setStatus('Authorizing LP burn...');
        const approveHash = await walletClient.writeContract({
          address: pool.pairAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [dex.router, liquidity],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const amount0Min = (amount0 * 99n) / 100n;
      const amount1Min = (amount1 * 99n) / 100n;

      if (pool.token0.isNative || pool.token1.isNative) {
        const token = pool.token0.isNative ? pool.token1 : pool.token0;
        const tokenMin = pool.token0.isNative ? amount1Min : amount0Min;
        const ethMin = pool.token0.isNative ? amount0Min : amount1Min;
        setStatus('Executing exit flow...');
        const hash = await walletClient.writeContract({
          address: dex.router,
          abi: ROUTER_ABI,
          functionName: 'removeLiquidityETH',
          args: [token.address, liquidity, tokenMin, ethMin, address, deadline],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      } else {
        setStatus('Executing exit flow...');
        const hash = await walletClient.writeContract({
          address: dex.router,
          abi: ROUTER_ABI,
          functionName: 'removeLiquidity',
          args: [pool.token0.address, pool.token1.address, liquidity, amount0Min, amount1Min, address, deadline],
        });
        await publicClient.waitForTransactionReceipt({ hash });
      }

      dex.refresh();
      setStatus('✓ Protocol exit confirmed');
      setTimeout(() => setStatus(''), 5000);
    } catch (error) {
      setStatus(error instanceof Error ? `Error: ${error.message.slice(0, 80)}` : 'Exit Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden h-fit">
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-20" />
      
      <SectionHeader
        className="mb-8 px-1 sm:items-end"
        title="Markets"
        description="Protocol-wide liquidity surveillance."
        right={(
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end gap-1">
              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/30 italic">Network Health</span>
              <div className="flex gap-2">
                <div className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 shadow-md">
                  <span className="text-[9px] font-black uppercase tracking-[0.1em] text-white/80">{dex.pools.length} Pairs</span>
                </div>
                <div className="flex items-center gap-1.5 rounded-lg border border-success/10 bg-success/5 px-3 py-1.5 shadow-md">
                  <span className="h-1 w-1 rounded-full bg-success animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-[0.1em] text-success/80">{connectedPositions} Positions</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={dex.refresh}
              className="btn btn-secondary !h-9 !px-4 !text-[9px] font-black uppercase tracking-[0.2em] shadow-lg"
            >
              Sync
            </button>
          </div>
        )}
      />

      {isWrongChain && (
        <div className="relative z-10 mb-6 rounded-2xl border border-warning/10 bg-warning/5 p-4 backdrop-blur-md flex items-center justify-between gap-4 px-1 animate-fade-in">
          <div className="flex items-center gap-3 px-3">
             <span className="text-lg">⚠️</span>
             <div className="text-[10px] font-black uppercase tracking-[0.15em] text-warning/70">Connect to Conflux eSpace (Chain 2030) to operate.</div>
          </div>
          <Button onClick={handleSwitchChain} variant="secondary" className="!h-8 !px-4 !text-[9px] font-black uppercase tracking-[0.2em] whitespace-nowrap shadow-md">Switch</Button>
        </div>
      )}

      {dex.loading && (
        <div className="flex items-center gap-2 px-1 mb-4">
          <div className="h-3 w-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-text-secondary/60 animate-pulse">Syncing Atlas...</p>
        </div>
      )}

      {!dex.loading && dex.pools.length === 0 && (
        <div className="relative py-16 rounded-2xl border border-dashed border-white/5 flex flex-col items-center justify-center bg-white/[0.01] mx-1">
          <div className="text-xs font-black text-white/40 uppercase tracking-[0.2em]">Zero Liquidity Index</div>
          <p className="mt-1 text-[10px] text-text-secondary/20 font-bold uppercase tracking-widest text-center italic">Protocol factory initialization required.</p>
        </div>
      )}

      {dex.pools.length > 0 && (
        <div className="relative">
          <div className="mb-3 hidden grid-cols-[minmax(0,2.2fr)_minmax(180px,1fr)_minmax(220px,1.2fr)_150px] gap-6 px-6 lg:grid">
            <div className="text-left text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/55 italic">Pair Hierarchy</div>
            <div className="text-left text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/55 italic">Global Depth</div>
            <div className="text-left text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/55 italic">Spot Index</div>
            <div className="text-right text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/55 italic">Control</div>
          </div>
          <div className="space-y-3">
              {dex.pools.map((p) => {
                const r0f = fmtReserve(p.reserve0, p.token0.decimals);
                const r1f = fmtReserve(p.reserve1, p.token1.decimals);
                const token0IsBase = p.token0.isNative;
                const tokenReserve = token0IsBase ? Number(p.reserve1) / 10 ** p.token1.decimals : Number(p.reserve0) / 10 ** p.token0.decimals;
                const cfxReserve = token0IsBase ? Number(p.reserve0) / 10 ** p.token0.decimals : Number(p.reserve1) / 10 ** p.token1.decimals;
                const price = tokenReserve > 0 ? cfxReserve / tokenReserve : 0;
                const hasPosition = isConnected && p.userLpBalance > 0n;
                const isOpen = activePool === p.pairAddress;

                return (
                  <div key={p.pairAddress} className="group">
                      <div className={`overflow-hidden rounded-2xl border transition-all duration-300 ${isOpen ? 'border-accent/30 bg-white/5 shadow-xl' : 'border-white/5 bg-white/[0.03] shadow-md hover:border-white/20 hover:bg-white/[0.06]'}`}>
                        <div className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,2.2fr)_minmax(180px,1fr)_minmax(220px,1.2fr)_150px] lg:items-center lg:gap-6 lg:px-6">
                          <div className="min-w-0">
                            <div className="flex flex-col gap-2">
                              <div className="flex flex-wrap items-center gap-2.5 lg:flex-nowrap">
                                <TokenBadge symbol={p.token0.symbol} address={p.token0.address} iconUrl={p.token0.iconUrl} />
                                <span className="hidden h-4 w-px bg-white/10 lg:block" />
                                <TokenBadge symbol={p.token1.symbol} address={p.token1.address} iconUrl={p.token1.iconUrl} />
                              </div>
                              {hasPosition && (
                                <div className="flex w-fit items-center gap-1.5 rounded-md border border-success/10 bg-success/5 px-2 py-0.5 text-[7px] font-black uppercase tracking-[0.1em] italic text-success/90">
                                   <span className="h-1 w-1 rounded-full bg-success animate-pulse" />
                                   LP Position Active
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col gap-0.5">
                              <div className="text-[7px] font-black uppercase tracking-[0.2em] text-text-secondary/60 italic">Global Reserves</div>
                              <div className="font-mono text-[11px] font-black tracking-normal text-white/95">
                                {r0f} <span className="text-white/10">:</span> {r1f}
                              </div>
                          </div>

                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_96px] lg:items-center">
                            <div className="flex flex-col gap-0.5">
                              <div className="text-[7px] font-black uppercase tracking-[0.2em] text-text-secondary/60 italic">Rate Index</div>
                              <div className="font-mono text-[11px] font-black text-accent drop-shadow-[0_0_4px_rgba(79,142,255,0.2)]">
                                {price > 0 ? `${fmtNum(price)} CFX` : '—'}
                              </div>
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="text-[7px] font-black uppercase tracking-[0.2em] text-text-secondary/60 italic">Inventory</div>
                              <div className="font-mono text-[11px] font-black text-white/85">{hasPosition ? `${getSharePct(p).toFixed(3)}%` : '—'}</div>
                            </div>
                          </div>

                          <div className="flex items-center justify-end gap-3 lg:pr-1">
                            <CopyButton copyText={p.pairAddress} title={`Pair: ${p.pairAddress}\nClick to copy`} size="md" stopPropagation className="shadow-sm hover:scale-105" />
                            <Button
                              onClick={() => (hasPosition ? setActivePool(isOpen ? null : p.pairAddress) : null)}
                              variant={isOpen ? 'primary' : 'secondary'}
                              className={`!h-9 !px-5 !text-[9px] font-black uppercase tracking-[0.2em] rounded-xl transition-all ${!hasPosition ? 'opacity-30 cursor-not-allowed' : 'hover:scale-105 shadow-md'}`}
                            >
                              {isOpen ? 'Close' : 'Manage'}
                            </Button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="animate-fade-in-up border-t border-white/5 bg-black/10 p-6 backdrop-blur-xl">
                            <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                              <div>
                                <h3 className="text-base font-black text-white uppercase tracking-tighter">Exit Protocol Flow</h3>
                                <p className="mt-0.5 text-[10px] text-text-secondary/40 uppercase font-black tracking-widest italic leading-none">Recover proportional underlying asset depth.</p>
                              </div>
                              <div className="flex items-center gap-1 rounded-xl border border-white/5 bg-white/5 p-1 shadow-inner">
                                {[25, 50, 75, 100].map((pct) => (
                                  <button
                                    type="button"
                                    key={pct}
                                    onClick={() => setRemovePercent(pct)}
                                    className={`rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] transition-all duration-300 ${removePercent === pct ? 'bg-accent text-white shadow-lg' : 'text-text-secondary/30 hover:text-white hover:bg-white/5'}`}
                                  >
                                    {pct}%
                                  </button>
                                ))}
                              </div>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                              <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner transition-all hover:border-white/10">
                                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic leading-none mb-2">LP Balance</div>
                                <div className="font-mono text-xs font-black text-white/90 tracking-widest tabular-nums">{Number(formatUnits(getRemoveEstimates(p, removePercent).liquidity, 18)).toLocaleString()} UNIT</div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner transition-all hover:border-accent/30">
                                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic leading-none mb-2">Claimable {p.token0.symbol}</div>
                                <div className="font-mono text-xs font-black text-white/90 tracking-widest tabular-nums">{Number(formatUnits(getRemoveEstimates(p, removePercent).amount0, p.token0.decimals)).toLocaleString()}</div>
                              </div>
                              <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner transition-all hover:border-accent/30">
                                <div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic leading-none mb-2">Claimable {p.token1.symbol}</div>
                                <div className="font-mono text-xs font-black text-white/90 tracking-widest tabular-nums">{Number(formatUnits(getRemoveEstimates(p, removePercent).amount1, p.token1.decimals)).toLocaleString()}</div>
                              </div>
                              <div className="flex flex-col">
                                <Button 
                                  onClick={() => (isWrongChain ? handleSwitchChain() : handleRemoveLiquidity(p))} 
                                  disabled={loading || isWrongChain} 
                                  variant="danger" 
                                  className="h-full w-full !text-[9px] font-black uppercase tracking-[0.2em] rounded-xl shadow-lg shadow-error/10 transition-all hover:scale-[1.02] py-4"
                                >
                                  {loading ? 'Quitting...' : isWrongChain ? 'Switch Chain' : 'Confirm Exit'}
                                </Button>
                              </div>
                            </div>
                            {status && activePoolData?.pairAddress === p.pairAddress && (
                              <StatusBanner
                                message={status}
                                tone={status.toLowerCase().includes('fail') || status.toLowerCase().includes('error') ? 'error' : 'accent'}
                                className="mt-4"
                                textClassName="tracking-[0.1em] italic"
                              />
                            )}
                          </div>
                        )}
                      </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}


