import { useEffect, useMemo, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { parseUnits } from 'viem';
import type { DexState } from '../hooks/useDex';
import { Button, SectionHeader, SelectMenu, StatusBanner, type SelectMenuOption } from '@cfxdevkit/ui-shared';
import { confluxLocalESpace } from '../chains';
import { fetchKnownTokenCatalog, type KnownTokenEntry } from '../lib/knownTokens';

const MIRROR_DEPLOY_ABI = [
  {
    inputs: [
      { name: 'name_', type: 'string' },
      { name: 'symbol_', type: 'string' },
      { name: 'decimals_', type: 'uint8' },
    ],
    stateMutability: 'nonpayable',
    type: 'constructor',
  },
] as const;

const MIRROR_MINT_ABI = [
  {
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface Props {
  dex: DexState;
}

function normalizeSupplyInput(value: string): string {
  return value.replace(/[,_\s]/g, '').trim();
}

function isNormalizedSupply(value: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(value);
}

function formatCompactSupply(value: string): string {
  const normalized = normalizeSupplyInput(value);
  if (!normalized || !isNormalizedSupply(normalized)) {
    return '—';
  }

  const [wholePart, fractionalPart = ''] = normalized.split('.');
  const trimmedWhole = wholePart.replace(/^0+(?=\d)/, '') || '0';
  const units = [
    { suffix: 'T', power: 12 },
    { suffix: 'B', power: 9 },
    { suffix: 'M', power: 6 },
    { suffix: 'K', power: 3 },
  ] as const;

  for (const unit of units) {
    if (trimmedWhole.length <= unit.power) continue;
    const splitIndex = trimmedWhole.length - unit.power;
    const integerPart = trimmedWhole.slice(0, splitIndex);
    const decimalSource = `${trimmedWhole.slice(splitIndex)}${fractionalPart}`.replace(/0+$/, '');
    const decimalPart = decimalSource.slice(0, integerPart.length >= 3 ? 0 : 1);
    return `${integerPart}${decimalPart ? `.${decimalPart}` : ''}${unit.suffix}`;
  }

  return normalized;
}

function StepBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <div className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.15em] transition-all duration-500 ${active ? 'border-accent/30 bg-accent/10 text-white shadow-md' : 'border-white/5 bg-white/5 text-text-secondary/20'}`}>
      {label}
    </div>
  );
}

type CreatePhase = 'configure' | 'deploying' | 'registering' | 'registered';

export function CreateToken({ dex }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState('18');
  const [supply, setSupply] = useState('1000000');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [deployedAddr, setDeployedAddr] = useState('');
  const [phase, setPhase] = useState<CreatePhase>('configure');
  const [knownTokens, setKnownTokens] = useState<KnownTokenEntry[]>([]);
  const [selectedKnownAddress, setSelectedKnownAddress] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchKnownTokenCatalog().then((catalog) => {
      if (cancelled) return;
      setKnownTokens([...catalog.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isWrongChain = isConnected && chainId !== confluxLocalESpace.id;
  const handleSwitchChain = () => {
    switchChain?.({ chainId: confluxLocalESpace.id });
  };

  const trimmedName = name.trim();
  const trimmedSymbol = symbol.trim();
  const parsedDecimals = Number(decimals || '18');
  const normalizedSupply = normalizeSupplyInput(supply);
  const isValidSupply = !normalizedSupply || isNormalizedSupply(normalizedSupply);
  const isFormValid = !!trimmedName && !!trimmedSymbol && isValidSupply && Number.isFinite(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 18;
  const selectedKnownToken = useMemo(
    () => knownTokens.find((token) => token.address === selectedKnownAddress),
    [knownTokens, selectedKnownAddress],
  );
  const knownTokenOptions = useMemo<SelectMenuOption[]>(() => ([
    { value: '', label: 'Custom local token' },
    ...knownTokens.map((token) => ({ value: token.address, label: token.symbol, iconUrl: token.iconUrl ?? undefined })),
  ]), [knownTokens]);
  const decimalOptions = useMemo<SelectMenuOption[]>(() => [6, 8, 12, 18].map((value) => ({ value: String(value), label: `${value} DEC` })), []);

  const applyKnownToken = (tokenAddress: string) => {
    setSelectedKnownAddress(tokenAddress);
    const token = knownTokens.find((entry) => entry.address === tokenAddress);
    if (!token) return;
    setName(token.name);
    setSymbol(token.symbol);
    setDecimals(String(token.decimals));
  };

  const handleCreate = async () => {
    if (isWrongChain) { handleSwitchChain(); return; }
    if (!walletClient || !publicClient || !address) return;
    if (!trimmedName || !trimmedSymbol) {
      setStatus('Identity Required');
      return;
    }
    if (!isValidSupply) {
      setStatus('Invalid Supply');
      return;
    }

    setLoading(true);
    setPhase('deploying');
    setStatus('Initializing Factory...');
    setDeployedAddr('');

    try {
      const bcRes = await fetch(`${import.meta.env.BASE_URL}api/dex/artifact/MirrorERC20`, { signal: AbortSignal.timeout(5000) });
      if (!bcRes.ok) throw new Error('Protocol Artifact Failure');
      const artifact = await bcRes.json();
      const bytecode = artifact.bytecode as `0x${string}`;
      if (!bytecode) throw new Error('Empty Bytecode');

      const hash = await walletClient.deployContract({
        abi: MIRROR_DEPLOY_ABI,
        bytecode,
        args: [trimmedName, trimmedSymbol, parsedDecimals],
      });

      setStatus('Syncing Chain...');
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });

      if (!receipt.contractAddress) throw new Error('Deployment Address Error');

      const tokenAddr = receipt.contractAddress;
      setDeployedAddr(tokenAddr);

      const supplyWei = normalizedSupply ? parseUnits(normalizedSupply, parsedDecimals) : 0n;
      if (supplyWei > 0n) {
        setStatus('Seeding Supply...');
        const mintHash = await walletClient.writeContract({
          address: tokenAddr,
          abi: MIRROR_MINT_ABI,
          functionName: 'mint',
          args: [address, supplyWei],
        });
        await publicClient.waitForTransactionReceipt({ hash: mintHash, timeout: 120_000 });
      }

      setPhase('registering');
      setStatus('Indexing Protocol...');
      const registrationResponse = await fetch(`${import.meta.env.BASE_URL}api/dex/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          address: tokenAddr,
          chain: 'evm',
          deployer: address,
          txHash: hash,
          chainId: 2030,
          abi: JSON.stringify([...MIRROR_DEPLOY_ABI, ...MIRROR_MINT_ABI,
            { inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
            { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
            { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
            { inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
            { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
          ]),
          metadata: selectedKnownToken
            ? {
                realAddress: selectedKnownToken.address,
                symbol: selectedKnownToken.symbol,
                decimals: selectedKnownToken.decimals,
              }
            : {
                symbol: trimmedSymbol,
                decimals: parsedDecimals,
              },
        }),
      });
      if (!registrationResponse.ok) {
        throw new Error('Registry Sync Failure');
      }

      setPhase('registered');
      setStatus(`✓ Asset Indexed: ${tokenAddr.slice(0, 10)}…`);
      setName('');
      setSymbol('');
      setDecimals('18');
      setSupply('1000000');
      setSelectedKnownAddress('');
      dex.refresh();
      setTimeout(() => setStatus(''), 8000);
    } catch (err) {
      setPhase('configure');
      setStatus(`Error: ${err instanceof Error ? err.message.slice(0, 80) : 'unknown'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden h-fit">
      <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-accent/5 rounded-full blur-[80px] pointer-events-none opacity-20" />
      
      <SectionHeader
        className="mb-8 px-1"
        title="Forge"
        description="Genesis deployment center."
        right={(
          <div className="flex flex-wrap items-center gap-2">
            <StepBadge active={phase === 'configure'} label="Set" />
            <StepBadge active={phase === 'deploying'} label="Push" />
            <StepBadge active={phase === 'registering' || phase === 'registered'} label="Sync" />
          </div>
        )}
      />

      <div className="relative grid gap-6">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-6 shadow-inner transition-all focus-within:border-accent/30 focus-within:bg-white/[0.04]">
          <div className="mb-6 text-[8px] font-black uppercase tracking-[0.3em] text-text-secondary/20 italic">Asset Specification</div>
          
          <div className="grid gap-6">
            <div className="grid gap-3">
              <label htmlFor="create-token-catalog" className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/40">Known Token Preset</label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <SelectMenu
                  options={knownTokenOptions}
                  value={selectedKnownAddress}
                  onChange={applyKnownToken}
                  disabled={loading || knownTokenOptions.length === 0}
                  className="w-full"
                  menuClassName="min-w-[220px]"
                />
                {selectedKnownToken?.iconUrl ? (
                  <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/5 px-3 py-2">
                    <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white/90 p-[2px]">
                      <img
                        src={selectedKnownToken.iconUrl}
                        alt=""
                        width={20}
                        height={20}
                        className="h-full w-full object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    </div>
                    <span className="text-[8px] font-black uppercase tracking-[0.12em] text-text-secondary/60">Catalog icon</span>
                  </div>
                ) : null}
              </div>
              <p className="text-[9px] leading-relaxed text-text-secondary/45">
                Choose a known token to prefill metadata and bind the local mirror to the catalog icon.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
              <div className="flex flex-col gap-2">
                <label htmlFor="create-token-name" className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/40">Formal Identity</label>
                <input
                  id="create-token-name"
                  className="bg-transparent border-none px-0 py-0 font-mono text-lg font-black tracking-tight text-white outline-none placeholder:text-white/5"
                  placeholder="Local Wrapped Gold"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="create-token-symbol" className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/40">Symbol</label>
                <input
                  id="create-token-symbol"
                  className="bg-transparent border-none px-0 py-0 font-mono text-lg font-black tracking-tight text-accent outline-none placeholder:text-accent/5 uppercase"
                  placeholder="LWG"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label htmlFor="create-token-decimals" className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/40">Precision</label>
                <SelectMenu
                  options={decimalOptions}
                  value={decimals}
                  onChange={setDecimals}
                  disabled={loading}
                />
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="create-token-supply" className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/40">Injection</label>
                <input
                  id="create-token-supply"
                  className="bg-transparent border border-white/10 rounded-lg h-9 px-3 font-mono text-xs font-black tracking-widest text-white outline-none placeholder:text-white/5 focus:border-accent/40"
                  value={supply}
                  onChange={(e) => setSupply(e.target.value)}
                  disabled={loading}
                  placeholder="1000000"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner transition-all hover:border-accent/20">
            <h3 className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">State Machine</h3>
            {deployedAddr ? (
              <div className="mt-3 rounded-lg border border-success/10 bg-success/5 p-3 shadow-md animate-fade-in-up">
                <div className="text-[7px] font-black uppercase tracking-[0.1em] text-success/80">Success confirmed</div>
                <code className="mt-1 block truncate text-[9px] font-mono text-white/60">{deployedAddr}</code>
              </div>
            ) : (
              <div className="mt-3 text-[9px] font-bold uppercase tracking-[0.1em] leading-relaxed text-text-secondary/30 italic">
                Finalized on-chain instantly and indexed in local registry.
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/5 bg-white/5 p-4 backdrop-blur-md shadow-inner transition-all hover:border-white/10">
            <h3 className="text-[8px] font-black uppercase tracking-[0.2em] text-text-secondary/20 italic">Draft</h3>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-0.5">
                <div className="text-[7px] font-black uppercase tracking-[0.1em] text-text-secondary/30">Ticker</div>
                <div className="font-mono text-[11px] font-black text-white/80">{trimmedSymbol || '—'}</div>
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="text-[7px] font-black uppercase tracking-[0.1em] text-text-secondary/30">Supply</div>
                <div className="font-mono text-[11px] font-black text-white/80">
                  {formatCompactSupply(supply)}
                </div>
              </div>
              <div className="col-span-2 flex items-center gap-2 pt-1">
                {selectedKnownToken?.iconUrl ? (
                  <div className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-white/90 p-[2px]">
                    <img
                      src={selectedKnownToken.iconUrl}
                      alt=""
                      width={20}
                      height={20}
                      className="h-full w-full object-contain"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                ) : null}
                <div className="text-[7px] font-black uppercase tracking-[0.1em] text-text-secondary/30">
                  {selectedKnownToken ? `Mirror source ${selectedKnownToken.address.slice(0, 8)}…` : 'No catalog binding'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <Button
          onClick={handleCreate}
          disabled={loading || (!isWrongChain && !isFormValid)}
          variant={isWrongChain ? 'secondary' : 'primary'}
          className="h-12 w-full !text-[10px] font-black uppercase tracking-[0.3em] rounded-xl shadow-xl shadow-accent/10 transition-all hover:scale-[1.01]"
        >
          {isWrongChain ? 'Switch to eSpace' : loading ? 'Indexing...' : 'Execute Genesis'}
        </Button>

        {status && (
          <StatusBanner
            message={status}
            tone={status.includes('✓') ? 'success' : status.includes('Error') ? 'error' : 'accent'}
            className="px-4 py-2"
            textClassName="tracking-[0.1em] leading-none"
          />
        )}
      </div>
    </div>
  );
}


