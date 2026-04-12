import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { parseEther } from 'viem';
import { exampleCounterAbi, useReadExampleCounterValue } from '../generated/hooks';
import { getContractAddress } from '../generated/contracts-addresses';
import { getChainLabel } from '../chains';
import { useAuth, } from '@cfxdevkit/ui-shared';
import { useDevkitNetworkSync } from '../hooks/useDevkitNetwork';

interface ContractEntry {
  name: string;
  address: string;
}

const EXAMPLE_CONTRACT_NAME = 'ExampleCounter';

export function ExampleContract() {
  const { address: walletAddress, isConnected } = useAccount();
  const { isAuthenticated, isLoading: isAuthLoading, error: authError, signIn } = useAuth();
  const { activeChainId, isWrongChain, switchToTargetChain, targetChainId } = useDevkitNetworkSync();

  const [contract, setContract] = useState<ContractEntry | null>(null);
  const [writeError, setWriteError] = useState('');
  const [status, setStatus] = useState('');
  const [lockAmount, setLockAmount] = useState('0.25');
  const [lockMinutes, setLockMinutes] = useState('5');
  const activeChainLabel = getChainLabel(activeChainId);
  const targetChainLabel = getChainLabel(targetChainId);
  const { writeContractAsync, data: txHash, isPending: isWriting } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: counterValue } = useReadExampleCounterValue({
    address: contract?.address as `0x${string}` | undefined,
    chainId: targetChainId,
    query: {
      enabled: !!contract?.address,
      refetchInterval: 5_000,
    },
  });

  const { data: lockInfo } = useReadContract({
    abi: exampleCounterAbi,
    address: contract?.address as `0x${string}` | undefined,
    chainId: targetChainId,
    functionName: 'getLock',
    args: walletAddress ? [walletAddress] : undefined,
    query: {
      enabled: !!contract?.address && !!walletAddress,
      refetchInterval: 5_000,
    },
  });

  const activeLock = useMemo(() => {
    if (!lockInfo) return null;
    const [amount, unlockTimestamp, claimable] = lockInfo;
    return { amount, unlockTimestamp, claimable };
  }, [lockInfo]);

  useEffect(() => {
    const resolvedAddress = getContractAddress(targetChainId, EXAMPLE_CONTRACT_NAME);
    if (!resolvedAddress) {
      setContract(null);
      return;
    }
    setContract({ name: EXAMPLE_CONTRACT_NAME, address: resolvedAddress });
  }, [targetChainId]);

  useEffect(() => {
    if (!txConfirmed) return;
    setStatus('✓ Finalized');
    const timer = setTimeout(() => setStatus(''), 5000);
    return () => clearTimeout(timer);
  }, [txConfirmed]);

  async function runWrite(action: () => Promise<unknown>, pendingLabel: string) {
    try {
      setWriteError('');
      setStatus(pendingLabel);
      await action();
      setStatus('Mempool Entry...');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Write failure';
      setWriteError(message);
      setStatus('');
    }
  }

  async function increment() {
    if (isWrongChain) { switchToTargetChain(); return; }
    if (!contract) return;
    await runWrite(
      () => writeContractAsync({ abi: exampleCounterAbi, address: contract.address as `0x${string}`, chainId: targetChainId, functionName: 'increment' }),
      'Incrementing...',
    );
  }

  async function reset() {
    if (isWrongChain) { switchToTargetChain(); return; }
    if (!contract) return;
    await runWrite(
      () => writeContractAsync({ abi: exampleCounterAbi, address: contract.address as `0x${string}`, chainId: targetChainId, functionName: 'reset' }),
      'Resetting...',
    );
  }

  async function lockFunds() {
    if (isWrongChain) { switchToTargetChain(); return; }
    if (!contract) return;
    const minutes = Number(lockMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setWriteError('Duration required');
      return;
    }

    const unlockTimestamp = BigInt(Math.floor(Date.now() / 1000) + minutes * 60);

    await runWrite(
      () => writeContractAsync({
        abi: exampleCounterAbi,
        address: contract.address as `0x${string}`,
        chainId: targetChainId,
        functionName: 'lock',
        args: [unlockTimestamp],
        value: parseEther(lockAmount || '0'),
      }),
      'Locking Assets...',
    );
  }

  async function withdrawLocked() {
    if (isWrongChain) { switchToTargetChain(); return; }
    if (!contract) return;
    await runWrite(
      () => writeContractAsync({ abi: exampleCounterAbi, address: contract.address as `0x${string}`, chainId: targetChainId, functionName: 'withdrawLocked' }),
      'Withdrawing...',
    );
  }

  const busy = isWriting || isConfirming;

  return (
    <div className="flex flex-col gap-6">
      {/* Interaction Shell */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 px-1">
        <div>
          <h2 className="text-xl font-black tracking-tighter text-white uppercase leading-none">Interactions</h2>
          <p className="mt-1 text-[11px] text-text-secondary/60 font-medium italic opacity-80">Execution hub for ExampleCounter protocol.</p>
        </div>
        <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.1em] border backdrop-blur-md shadow-md ${contract ? 'text-success/80 bg-success/5 border-success/10' : 'text-text-secondary/40 bg-white/5 border-white/5'}`}>
          <span className={`h-1 w-1 rounded-full ${contract ? 'bg-success animate-pulse' : 'bg-text-secondary/20'}`} />
          {contract ? 'Contract Verified' : 'Uninitialized'}
        </div>
      </div>

      {!contract && (
        <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/[0.02] p-8 text-center animate-fade-in">
          <div className="max-w-md mx-auto">
            <h3 className="text-sm font-black text-white/60 mb-2 uppercase tracking-widest leading-none">Registry Miss</h3>
            <p className="text-text-secondary/30 text-[11px] leading-relaxed mb-6 font-bold uppercase italic tracking-tighter">
              Protocol object not detected on {targetChainLabel}. Sync required via CLI:
            </p>
            <div className="relative group grayscale opacity-40 hover:grayscale-0 hover:opacity-100 transition-all">
              <pre className="relative px-4 py-3 rounded-xl bg-black/40 border border-white/5 text-accent/80 font-black font-mono text-[10px] overflow-x-auto shadow-inner">
                {targetChainId === 71 ? 'pnpm deploy:testnet' : targetChainId === 1030 ? 'pnpm deploy:mainnet' : 'pnpm deploy'}
              </pre>
            </div>
          </div>
        </div>
      )}

      {contract && (
        <div className="grid gap-6">
          {/* Metadata & State Grid */}
          <div className="grid gap-4 md:grid-cols-12">
            <div className="md:col-span-8 rounded-2xl border border-white/5 bg-bg-secondary/40 p-6 shadow-xl backdrop-blur-2xl transition-all duration-300">
               <div className="mb-4 flex items-center justify-between">
                  <div className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">Live State Engine</div>
                  <span className="text-[8px] font-mono text-accent/30 tracking-tighter">{contract.address}</span>
               </div>
               <div className="grid gap-6 sm:grid-cols-2">
                  <div className="flex flex-col justify-center">
                    <div className="text-[9px] uppercase font-black tracking-widest text-text-secondary/40 italic leading-none mb-2">Counter Value</div>
                    <div className="text-4xl font-black text-white tracking-tighter tabular-nums drop-shadow-[0_0_10px_rgba(255,255,255,0.1)]">
                      {typeof counterValue === 'bigint' ? counterValue.toString() : '—'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-3 justify-center border-l border-white/5 pl-6">
                    <div>
                      <div className="text-[7px] uppercase font-black tracking-widest text-text-secondary/20 italic mb-0.5">Compiler</div>
                      <div className="font-black text-[10px] text-text-primary/60 tracking-wider">Solidity 0.8.x</div>
                    </div>
                    <div>
                      <div className="text-[7px] uppercase font-black tracking-widest text-text-secondary/20 italic mb-0.5">Architecture</div>
                      <div className="font-black text-[10px] text-text-primary/60 tracking-wider">Stateful Engine</div>
                    </div>
                  </div>
               </div>
            </div>

            {activeLock && (
              <div className="md:col-span-4 rounded-2xl border border-accent/10 bg-accent/5 p-6 shadow-xl backdrop-blur-2xl animate-fade-in">
                 <div className="mb-4 text-[8px] font-black uppercase tracking-[0.2em] text-accent/40 italic">Active Lock</div>
                 <div className="space-y-4">
                    <div className="text-center">
                      <div className="text-[8px] uppercase font-black tracking-widest text-accent/30 italic mb-1">Vaulted</div>
                      <div className="text-xl font-black text-white tracking-tight">{Number(activeLock.amount) / 1e18} <span className="text-[10px] text-accent/60">CFX</span></div>
                    </div>
                    <div className="pt-3 border-t border-accent/10 grid grid-cols-2 gap-2 text-center">
                      <div>
                        <div className="text-[7px] uppercase font-black tracking-widest text-accent/30 mb-0.5">Expiry</div>
                        <div className="font-mono text-[9px] font-black text-text-primary/60">
                          {activeLock.unlockTimestamp > 0n ? new Date(Number(activeLock.unlockTimestamp) * 1000).toLocaleTimeString() : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[7px] uppercase font-black tracking-widest text-accent/30 mb-0.5">Status</div>
                        <div className={`text-[8px] font-black uppercase tracking-widest ${activeLock.claimable ? 'text-success animate-pulse' : 'text-text-secondary/30'}`}>
                          {activeLock.claimable ? 'Ready' : 'Locked'}
                        </div>
                      </div>
                    </div>
                 </div>
              </div>
            )}
          </div>

          {/* Actions Section */}
          {!isConnected ? (
            <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01] p-10 text-center">
              <div className="text-[10px] font-black text-white/30 uppercase tracking-[0.25em] italic">Authorization Required</div>
              <p className="mt-2 text-[10px] text-text-secondary/20 font-bold uppercase tracking-widest italic">Connect wallet to authorize protocol writes.</p>
            </div>
          ) : isWrongChain ? (
            <div className="rounded-2xl border border-warning/10 bg-warning/5 p-8 flex flex-col items-center gap-4 text-center shadow-md">
              <p className="text-[11px] text-text-secondary/60 max-w-xs font-bold uppercase italic tracking-tighter leading-relaxed">
                Wallet network mismatch detected. Active on <span className="text-warning">{activeChainLabel}</span>. Target: <span className="text-accent">{targetChainLabel}</span>.
              </p>
              <button type="button" onClick={switchToTargetChain} className="btn btn-secondary !h-9 !px-6 !text-[10px] font-black uppercase tracking-[0.2em] shadow-lg">
                Migrate Session
              </button>
            </div>
          ) : !isAuthenticated ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 flex flex-col items-center gap-4 text-center shadow-md backdrop-blur-xl">
              <p className="text-text-secondary/40 text-[11px] max-w-xs font-bold uppercase italic tracking-tighter leading-relaxed">
                Secure session initialization required. Sign authorization to verify ownership.
              </p>
              <button
                type="button"
                onClick={() => void signIn()}
                disabled={isAuthLoading}
                className="btn btn-primary !h-10 !px-8 !text-[10px] font-black uppercase tracking-[0.2em] shadow-xl shadow-accent/20"
              >
                {isAuthLoading ? 'Authorizing...' : 'Initialize Session'}
              </button>
              {authError && (
                <p className="text-error text-[8px] font-black uppercase italic tracking-widest mt-1 opacity-60">{authError}</p>
              )}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Basic Interactions */}
              <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-md">
                 <div className="mb-1 text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">Core Methods</div>
                 <div className="grid gap-3">
                    <button type="button" onClick={increment} disabled={busy} className="btn btn-primary !h-12 !text-[11px] font-black uppercase tracking-[0.3em] rounded-xl shadow-xl transition-all">
                      {busy ? 'Processing...' : 'Inc State'}
                    </button>
                    <button type="button" onClick={reset} disabled={busy} className="btn btn-ghost !h-9 !text-[9px] font-black uppercase tracking-[0.2em] text-text-secondary/40 hover:text-white">
                      Reset Engine
                    </button>
                 </div>
              </div>

              {/* Timelock Config */}
              <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-md transition-all focus-within:border-accent/20 focus-within:bg-white/[0.04]">
                <div className="mb-4 text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">Timelock Parameters</div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="lock-amount" className="text-[8px] font-black uppercase tracking-[0.15em] text-text-secondary/40 pl-1 italic">Amount</label>
                    <input
                        id="lock-amount"
                        className="bg-transparent border border-white/5 rounded-lg h-9 px-3 font-mono text-[11px] font-black tracking-widest text-white outline-none focus:border-accent/30 focus:bg-white/5"
                        value={lockAmount}
                        onChange={(e) => setLockAmount(e.target.value)}
                        inputMode="decimal"
                        placeholder="0.25"
                      />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="lock-minutes" className="text-[8px] font-black uppercase tracking-[0.15em] text-text-secondary/40 pl-1 italic">Min</label>
                    <input
                        id="lock-minutes"
                        className="bg-transparent border border-white/5 rounded-lg h-9 px-3 font-mono text-[11px] font-black tracking-widest text-white outline-none focus:border-accent/30 focus:bg-white/5"
                        value={lockMinutes}
                        onChange={(e) => setLockMinutes(e.target.value)}
                        inputMode="numeric"
                        placeholder="5"
                      />
                  </div>
                </div>
                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={lockFunds} disabled={busy} className="btn btn-secondary !h-9 !text-[9px] font-black uppercase tracking-[0.2em]">
                    Lock
                  </button>
                  <button type="button" onClick={withdrawLocked} disabled={busy || !activeLock?.claimable} className="btn btn-danger !h-9 !text-[9px] font-black uppercase tracking-[0.2em]">
                    Claim
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Status Feedback */}
          {status && (
            <div className="px-4 py-2 rounded-xl bg-accent/5 border border-accent/10 animate-fade-in flex items-center gap-2">
              <div className="h-1 w-1 rounded-full bg-accent animate-pulse shadow-[0_0_5px_currentColor]" />
              <p className="text-accent/80 text-[9px] font-black uppercase tracking-[0.1em] italic">{status}</p>
            </div>
          )}
          {writeError && (
            <div className="px-4 py-2 rounded-xl bg-error/5 border border-error/10 animate-fade-in">
              <p className="text-error/60 text-[8px] font-black uppercase italic tracking-tight">Error: {writeError.slice(0, 100)}</p>
            </div>
          )}

          <div className="border-t border-white/5 pt-6 flex flex-col items-center gap-2 select-none opacity-20">
            <span className="text-[8px] font-black uppercase tracking-[0.3em] text-text-secondary">Wagmi Integrated Sandbox</span>
            <p className="text-text-secondary text-[7px] uppercase tracking-widest font-black leading-none italic">Type-safe hooks auto-generated from solidity</p>
          </div>
        </div>
      )}
    </div>
  );
}