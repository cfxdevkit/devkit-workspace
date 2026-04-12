import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { ConnectButton } from '@cfxdevkit/ui-shared';
import { confluxLocalESpace } from '../chains';

function ConfluxIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1766.6 2212" className="w-5 h-auto fill-accent transition-transform duration-500 group-hover:scale-110">
      <title>Conflux</title>
      <path d="M0,1309.5 L879.5,426.3 L1766.6,1317.2 L1766.6,892.7 L887.1,0 L1,895.7 Z"/>
      <path d="M203.6,1528.4 L875.6,2212 L1555.4,1528.4 L1348,1317.2 L879.5,1789.6 L626,1528.4 L1090.7,1052.2 L882.4,845.8 Z"/>
    </svg>
  );
}

export function NavBar() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const isWrongChain = isConnected && chainId !== confluxLocalESpace.id;

  const handleSwitchChain = () => {
    switchChain?.({ chainId: confluxLocalESpace.id });
  };

  return (
    <nav className="sticky top-0 z-50 border-b border-white/5 bg-bg-primary/70 backdrop-blur-2xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-5 py-2.5">
        <div className="flex items-center gap-3 cursor-default group">
          <ConfluxIcon />
          <div className="flex flex-col gap-0.5">
            <span className="font-black text-[1.05rem] text-white leading-tight tracking-tight uppercase">CFX <span className="text-accent">DEX</span></span>
            <div className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-text-secondary/40">
              <span className="text-text-secondary/60">eSpace</span>
              <span className="h-0.5 w-0.5 rounded-full bg-border/40" />
              <span className="group-hover:text-accent/60 transition-colors">Playground</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isWrongChain ? (
            <button
              type="button"
              onClick={handleSwitchChain}
              className="animate-pulse rounded-full border border-warning/30 bg-warning/10 px-3.5 py-1 text-[9px] font-black text-warning uppercase tracking-[0.18em] transition-all hover:bg-warning/20 hover:scale-105 active:scale-95 shadow-xl shadow-warning/5"
            >
              ⚠ Switch Network
            </button>
          ) : (
            <div className="hidden items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-3 py-1 text-[8px] font-black uppercase tracking-[0.18em] text-accent/60 md:flex shadow-inner">
              <span className="h-1 w-1 rounded-full bg-accent animate-pulse" />
              Sandbox Active
            </div>
          )}
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
