import { useAccount } from 'wagmi';
import { usePublicClient } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { useCallback, useEffect, useState } from 'react';
import type { TokenInfo } from '../hooks/useDex';

import { CopyButton, SectionHeader } from '@cfxdevkit/ui-shared';

interface BalanceRow {
  token: TokenInfo;
  balance: string;
}

export function TokenBalances({ tokens }: { tokens: TokenInfo[] }) {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const [balances, setBalances] = useState<BalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const loadBalances = useCallback(async () => {
    if (!isConnected || !address || !publicClient || tokens.length === 0) {
      setBalances([]);
      return;
    }

    setLoading(true);
    const rows: BalanceRow[] = [];
    for (const token of tokens) {
      try {
        if (token.isNative) {
          const balance = await publicClient.getBalance({ address });
          rows.push({ token, balance: formatUnits(balance, 18) });
        } else {
          const balance = await publicClient.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          });
          rows.push({ token, balance: formatUnits(balance, token.decimals) });
        }
      } catch {
        rows.push({ token, balance: '—' });
      }
    }

    setBalances(rows);
    setLoading(false);
  }, [isConnected, address, publicClient, tokens]);
  const refresh = useCallback(() => {
    void loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    void loadBalances();
  }, [loadBalances]);

  useEffect(() => {
    if (!isConnected) return;
    const iv = setInterval(refresh, 10_000);
    return () => clearInterval(iv);
  }, [isConnected, refresh]);

  if (!isConnected) {
    return (
      <div className="rounded-[1.5rem] border border-white/5 bg-bg-secondary/40 p-6 backdrop-blur-2xl shadow-lg relative overflow-hidden h-fit">
        <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-success/5 rounded-full blur-[80px] pointer-events-none opacity-20" />
        <h2 className="text-xl font-black tracking-tighter text-white uppercase mb-2">Portfolio</h2>
        <p className="text-[11px] text-text-secondary/60 font-medium leading-relaxed italic opacity-80">Connect wallet to authorize asset surveillance and balance indexing.</p>
      </div>
    );
  }

  const validBalances = balances.filter((b) => b.balance !== '0' && b.balance !== '—' && Number(b.balance) > 0);

  return (
    <div className="rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden h-fit">
      <div className="absolute top-0 left-0 -ml-16 -mt-16 w-64 h-64 bg-success/5 rounded-full blur-[80px] pointer-events-none opacity-20" />
      
      <SectionHeader
        className="mb-8"
        title="Inventory"
        description="Asset surveillance index v2."
        right={(
          <div className="flex items-center gap-3">
            {balances.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-lg border border-success/10 bg-success/5 px-3 py-1.5 shadow-md italic">
                <span className="h-1 w-1 rounded-full bg-success animate-pulse" />
                <span className="text-[9px] font-black uppercase tracking-[0.1em] text-success/80">
                  {validBalances.length} Token{validBalances.length === 1 ? '' : 's'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={refresh}
              className="btn btn-secondary !h-8 !px-4 !text-[9px] font-black uppercase tracking-[0.2em] shadow-lg"
            >
              Sync
            </button>
          </div>
        )}
      />
      
      {loading && balances.length === 0 && (
        <div className="flex items-center gap-2 px-1 mb-4">
          <div className="h-3 w-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-text-secondary/40 animate-pulse italic">Scanning Vaults...</p>
        </div>
      )}
      
      {!loading && balances.length === 0 && (
        <div className="py-16 rounded-2xl border border-dashed border-white/5 flex flex-col items-center justify-center bg-white/[0.01]">
          <div className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Zero Balance State</div>
          <p className="mt-1 text-[9px] text-text-secondary/20 font-bold uppercase tracking-widest text-center italic">No spendable assets indexed in this range.</p>
        </div>
      )}
      
      {balances.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left text-[8px] font-black uppercase tracking-[0.3em] text-text-secondary/20 italic">
                <th className="pb-2 pl-6">Token Identifier</th>
                <th className="pb-2">Protocol Reference</th>
                <th className="pb-2 text-right pr-10">Available Depth</th>
              </tr>
            </thead>
            <tbody>
              {validBalances.map((b) => (
                <tr key={b.token.address} className="group">
                  <td colSpan={3} className="p-0">
                    <div className="flex h-16 items-center px-5 rounded-xl border border-white/5 bg-white/[0.03] backdrop-blur-md shadow-md transition-all duration-300 hover:border-accent/30 hover:bg-white/[0.06]">
                      <div className="flex items-center gap-3 w-[35%] shrink-0">
                        <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-white/5 bg-bg-tertiary/20 shadow-lg group-hover:scale-105 transition-all">
                          {b.token.iconUrl ? (
                            <div className="flex h-full w-full items-center justify-center bg-white/90 p-1">
                              <img src={b.token.iconUrl} alt="" width={36} height={36} className="h-full w-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                            </div>
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] font-black uppercase text-accent/60">{b.token.symbol[0]}</div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-black tracking-tight text-white text-sm uppercase">{b.token.symbol}</div>
                          <div className="text-[7px] font-black uppercase text-text-secondary/30 tracking-[0.1em] italic leading-none">{b.token.isNative ? 'Native' : 'ERC-20'}</div>
                        </div>
                      </div>

                      <div className="flex flex-1 items-center gap-3 min-w-0 px-2">
                        <span className="font-mono text-[9px] font-bold text-text-secondary/30 group-hover:text-text-secondary/50 transition-colors truncate italic">{b.token.isNative ? 'Local Protocol Mesh' : b.token.address}</span>
                        {!b.token.isNative && (
                          <CopyButton copyText={b.token.address} title={`${b.token.symbol}: ${b.token.address}\nClick to copy`} />
                        )}
                      </div>

                      <div className="pl-4 text-right pr-2">
                        <div className="font-mono font-black text-white/90 text-sm md:text-base tracking-tight tabular-nums">
                          {b.balance === '—' ? '—' : Number(b.balance).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                        </div>
                        <div className="text-[7px] text-accent/40 uppercase font-black tracking-[0.1em] italic leading-none mt-0.5">confirmed</div>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
              {validBalances.length === 0 && !loading && (
                <tr className="group">
                  <td colSpan={3} className="p-0">
                    <div className="py-16 rounded-2xl border border-dashed border-white/5 flex flex-col items-center justify-center bg-white/[0.01]">
                      <div className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em]">Zero Inventory</div>
                      <p className="mt-1 text-[9px] text-text-secondary/20 font-bold uppercase tracking-widest text-center italic max-w-[240px]">Use the Faucet or deploy new assets to populate this index.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
