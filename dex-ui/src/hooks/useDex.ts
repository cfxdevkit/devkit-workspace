import { useCallback, useEffect, useState } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import { type Abi, erc20Abi, parseAbi } from 'viem';
import { fetchKnownTokenCatalog, fetchTokenIconOverrides, resolveKnownToken } from '../lib/knownTokens';

// ── ABI fragments ────────────────────────────────────────────────────────────
const FACTORY_ABI = parseAbi([
  'function allPairsLength() view returns (uint256)',
  'function allPairs(uint256) view returns (address)',
]);

const PAIR_ABI = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);

const WCFX_MAINNET = '0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b';

export const ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256, address[]) view returns (uint256[])',
  'function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])',
  'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])',
  'function swapExactTokensForETH(uint256,uint256,address[],address,uint256) returns (uint256[])',
  'function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256) returns (uint256,uint256)',
  'function removeLiquidityETH(address,uint256,uint256,uint256,address,uint256) returns (uint256,uint256)',
]) as Abi;

export const VAULT_ABI = parseAbi([
  'function deposit(address,uint256)',
  'function depositNative() payable',
  'function withdraw(address,uint256)',
  'function balanceOf(address,address) view returns (uint256)',
]) as Abi;

// ── Types ────────────────────────────────────────────────────────────────────
export interface TokenInfo {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  isNative?: boolean;
  iconUrl?: string;
  realAddress?: `0x${string}`;
}

export interface PoolInfo {
  pairAddress: `0x${string}`;
  token0: TokenInfo;
  token1: TokenInfo;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  userLpBalance: bigint;
}

export interface DexState {
  loading: boolean;
  error: string | null;
  factory: `0x${string}` | null;
  weth: `0x${string}` | null;
  router: `0x${string}` | null;
  vault: `0x${string}` | null;
  pools: PoolInfo[];
  tokens: TokenInfo[];
  refresh: () => void;
}

function isInfrastructureContract(name: string | undefined): boolean {
  if (!name) return false;
  return /uniswapv2(factory|router|pair)|weth9|payablevault/i.test(name);
}

// ── Translation table (for icon URLs) ────────────────────────────────────────
interface TranslationEntry {
  realAddress: string;
  localAddress: string;
  symbol: string;
  iconCached: boolean;
}

interface TranslationTable {
  chainId: number;
  entries: TranslationEntry[];
}

interface DeployedContractMetadata {
  realAddress?: string;
  symbol?: string;
  decimals?: number;
}

async function fetchTranslationTable(): Promise<Map<string, TranslationEntry>> {
  const map = new Map<string, TranslationEntry>();
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}translation-table.json?v=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return map;
    const data = await r.json() as TranslationTable;
    if (data?.entries) {
      for (const e of data.entries) {
        map.set(e.localAddress.toLowerCase(), e);
      }
    }
  } catch { /* ignore */ }
  return map;
}

// ── Contract discovery ───────────────────────────────────────────────────────
interface DeployedContract {
  name: string;
  address: string;
  metadata?: DeployedContractMetadata;
}

async function fetchContracts(): Promise<DeployedContract[]> {
  const results = await Promise.allSettled([
    fetch(`${import.meta.env.BASE_URL}api/contracts/deployed`, { signal: AbortSignal.timeout(5000) })
      .then((r) => r.json())
      .then((d) => {
        const list = d?.data?.contracts ?? d?.contracts ?? (Array.isArray(d) ? d : []);
        return list as DeployedContract[];
      }),
    fetch(`${import.meta.env.BASE_URL}devkit-contracts.json`, { signal: AbortSignal.timeout(2000) })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => (Array.isArray(d) ? d : []) as DeployedContract[]),
  ]);

  const all: DeployedContract[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const c of r.value) {
        const key = c.address?.toLowerCase();
        if (key && !seen.has(key)) {
          seen.add(key);
          all.push(c);
        }
      }
    }
  }
  return all;
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useDex(): DexState {
  const publicClient = usePublicClient();
  const { address } = useAccount();
  const [state, setState] = useState<Omit<DexState, 'refresh'>>({
    loading: true,
    error: null,
    factory: null,
    weth: null,
    router: null,
    vault: null,
    pools: [],
    tokens: [],
  });
  const loadDexState = useCallback(async () => {
    let cancelled = false;

    if (!publicClient) return undefined;
    const client = publicClient;
    setState((s) => ({
      ...s,
      loading: s.pools.length === 0 && s.tokens.length === 0,
      error: null,
    }));

    try {
        // 1. Discover DEX contracts
        const contracts = await fetchContracts();
        const byBaseName = (base: string) =>
          contracts.find((c) => c.name === base || c.name === `${base}__devkit`);
        const factory = byBaseName('UniswapV2Factory');
        const weth = byBaseName('WETH9');
        const router = byBaseName('UniswapV2Router02');
        const vault = contracts.find((c) => c.name?.includes('PayableVault'));

        if (!factory || !weth || !router) {
          setState((s) => ({
            ...s,
            loading: false,
            error: 'V2 DEX not deployed — run dex_deploy + dex_seed_from_gecko',
          }));
          return;
        }

        const factoryAddr = factory.address as `0x${string}`;
        const wethAddr = weth.address as `0x${string}`;
        const routerAddr = router.address as `0x${string}`;
        const vaultAddr = vault ? (vault.address as `0x${string}`) : null;

        // Load translation table for icon URLs
        const [ttable, knownTokens, iconOverrides] = await Promise.all([
          fetchTranslationTable(),
          fetchKnownTokenCatalog(),
          fetchTokenIconOverrides(),
        ]);

        // 2. Load pairs
        const pairCount = await client.readContract({
          address: factoryAddr,
          abi: FACTORY_ABI,
          functionName: 'allPairsLength',
        });

        const tokenCache = new Map<string, TokenInfo>();
        const contractMetadataByAddress = new Map<string, DeployedContractMetadata>();
        for (const contract of contracts) {
          const contractAddr = contract.address?.toLowerCase();
          if (!contractAddr || !contract.metadata) continue;
          contractMetadataByAddress.set(contractAddr, contract.metadata);
        }

        async function getToken(addr: `0x${string}`, contractMetadata?: DeployedContractMetadata): Promise<TokenInfo> {
          const lc = addr.toLowerCase();
          const cachedToken = tokenCache.get(lc);
          if (cachedToken) return cachedToken;
          const translationEntry = ttable.get(lc);
          const resolvedMetadata = contractMetadata ?? contractMetadataByAddress.get(lc);
          const knownToken = resolveKnownToken(knownTokens, {
            contractAddress: lc,
            realAddress: lc === wethAddr.toLowerCase()
              ? WCFX_MAINNET
              : translationEntry?.realAddress ?? resolvedMetadata?.realAddress ?? null,
          });
          const overrideIconUrl = iconOverrides.get(lc)?.iconUrl
            ?? (translationEntry?.realAddress ? iconOverrides.get(translationEntry.realAddress.toLowerCase())?.iconUrl : undefined)
            ?? (resolvedMetadata?.realAddress ? iconOverrides.get(resolvedMetadata.realAddress.toLowerCase())?.iconUrl : undefined);
          const realAddress = (lc === wethAddr.toLowerCase()
            ? WCFX_MAINNET
            : translationEntry?.realAddress ?? resolvedMetadata?.realAddress ?? null) as `0x${string}` | null;
          let symbol = '???';
          let decimals = 18;
          if (lc === wethAddr.toLowerCase()) {
            symbol = 'CFX';
            decimals = knownToken?.decimals ?? 18;
          } else {
            try {
              const [s, d] = await Promise.all([
                client.readContract({ address: addr, abi: erc20Abi, functionName: 'symbol' }),
                client.readContract({ address: addr, abi: erc20Abi, functionName: 'decimals' }),
              ]);
              symbol = s;
              decimals = d;
            } catch {
              if (knownToken) {
                symbol = knownToken.symbol;
                decimals = knownToken.decimals;
              } else if (resolvedMetadata) {
                symbol = resolvedMetadata.symbol ?? symbol;
                decimals = typeof resolvedMetadata.decimals === 'number' ? resolvedMetadata.decimals : decimals;
              }
            }
          }
          const iconUrl = overrideIconUrl ?? knownToken?.iconUrl ?? undefined;
          const info: TokenInfo = {
            address: addr,
            symbol,
            decimals,
            isNative: lc === wethAddr.toLowerCase(),
            iconUrl,
            realAddress: realAddress ?? undefined,
          };
          tokenCache.set(lc, info);
          return info;
        }

        const pools: PoolInfo[] = [];
        for (let i = 0; i < Number(pairCount); i++) {
          if (cancelled) return;
          // Retry each pair up to 2 times (RPC can be flaky on local node)
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const pairAddress = await client.readContract({
                address: factoryAddr,
                abi: FACTORY_ABI,
                functionName: 'allPairs',
                args: [BigInt(i)],
              });
              const [t0Addr, t1Addr, reserves, totalSupply, userLpBalance] = await Promise.all([
                client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token0' }),
                client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'token1' }),
                client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'getReserves' }),
                client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'totalSupply' }),
                address
                  ? client.readContract({ address: pairAddress, abi: PAIR_ABI, functionName: 'balanceOf', args: [address] })
                  : Promise.resolve(0n),
              ]);
              const [token0, token1] = await Promise.all([
                getToken(t0Addr, contractMetadataByAddress.get(t0Addr.toLowerCase())),
                getToken(t1Addr, contractMetadataByAddress.get(t1Addr.toLowerCase())),
              ]);
              pools.push({
                pairAddress,
                token0,
                token1,
                reserve0: reserves[0],
                reserve1: reserves[1],
                totalSupply,
                userLpBalance,
              });
              break; // success — exit retry loop
            } catch (err) {
              if (attempt === 0) {
                // Wait briefly before retry
                await new Promise((r) => setTimeout(r, 300));
              } else {
                console.warn(`[useDex] Skipped pair ${i}/${pairCount}:`, err instanceof Error ? err.message : err);
              }
            }
          }
        }

        // Sort by CFX reserve descending
        pools.sort((a, b) => {
          const aBaseReserve = a.token0.isNative ? a.reserve0 : a.reserve1;
          const bBaseReserve = b.token0.isNative ? b.reserve0 : b.reserve1;
          if (aBaseReserve === bBaseReserve) return 0;
          return aBaseReserve > bBaseReserve ? -1 : 1;
        });

        // Build unique token list
        const seen = new Set<string>();
        const nativeToken = await getToken(wethAddr);
        const tokens: TokenInfo[] = [nativeToken];
        seen.add(wethAddr.toLowerCase());
        for (const p of pools) {
          for (const t of [p.token0, p.token1]) {
            if (!seen.has(t.address.toLowerCase())) {
              seen.add(t.address.toLowerCase());
              tokens.push(t);
            }
          }
        }

        const pairAddresses = new Set(pools.map((pool) => pool.pairAddress.toLowerCase()));
        for (const contract of contracts) {
          const contractAddr = contract.address?.toLowerCase();
          if (!contractAddr || seen.has(contractAddr) || pairAddresses.has(contractAddr)) continue;
          if (contractAddr === factoryAddr.toLowerCase() || contractAddr === routerAddr.toLowerCase() || contractAddr === vaultAddr?.toLowerCase()) continue;
          if (isInfrastructureContract(contract.name)) continue;

          try {
            const token = await getToken(contract.address as `0x${string}`, contract.metadata);
            if (token.symbol !== '???') {
              seen.add(contractAddr);
              tokens.push(token);
            }
          } catch {
            // Skip non-ERC20 contracts from the tracked registry.
          }
        }

      if (!cancelled) {
        setState({
          loading: false,
          error: null,
          factory: factoryAddr,
          weth: wethAddr,
          router: routerAddr,
          vault: vaultAddr,
          pools,
          tokens,
        });
      }
    } catch (err) {
      if (!cancelled) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        }));
      }
    }
    return () => {
      cancelled = true;
    };
  }, [publicClient, address]);
  const refresh = useCallback(() => {
    void loadDexState();
  }, [loadDexState]);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    void loadDexState().then((cleanup) => {
      dispose = cleanup;
    });

    return () => {
      dispose?.();
    };
  }, [loadDexState]);

  // Auto-refresh every 15 seconds
  useEffect(() => {
    const iv = setInterval(refresh, 15_000);
    return () => clearInterval(iv);
  }, [refresh]);

  return { ...state, refresh };
}
