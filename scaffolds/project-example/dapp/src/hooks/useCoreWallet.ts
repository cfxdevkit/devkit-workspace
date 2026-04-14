import { useEffect, useMemo, useState } from 'react';
import { appAbsoluteUrl } from '../app-base';
import { createPublicClient, createWalletClient, custom, http, formatCFX, type Address as CiveAddress } from 'cive';
import { base32AddressToHex, defineChain, hexAddressToBase32 } from 'cive/utils';

type ProviderRequestArgs = {
  method: string;
  params?: unknown[] | Record<string, unknown>;
};

type ConfluxProvider = {
  isFluent?: boolean;
  request: (args: ProviderRequestArgs) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window {
    conflux?: ConfluxProvider;
  }
}

function getConfluxProvider(): ConfluxProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.conflux ?? null;
}

function getFirstAccount(value: unknown): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const [account] = value;
  return typeof account === 'string' && account.length > 0 ? account : null;
}

function getChainId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return `0x${value.toString(16)}`;
  }

  if (typeof value === 'bigint' && value >= 0n) {
    return `0x${value.toString(16)}`;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('0x')) {
    return normalized;
  }

  if (/^\d+$/.test(normalized)) {
    return `0x${Number(normalized).toString(16)}`;
  }

  return normalized;
}

async function requestNoParams(provider: ConfluxProvider, method: string): Promise<unknown> {
  return provider.request({ method, params: [] });
}

function formatError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeError = error as { code?: number; message?: string };
    if (typeof maybeError.message === 'string' && typeof maybeError.code === 'number') {
      return `${maybeError.message} (code ${maybeError.code})`;
    }
    if (typeof maybeError.message === 'string') {
      return maybeError.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to reach the Core Space wallet.';
}

export interface CoreChainConfig {
  coreChainId: number;
  chainIdHex: string;
  label: string;
  rpcUrl: string;
  rpcUrls: string[];
  blockExplorerUrl?: string;
}

export interface CoreSnapshot {
  balanceCFX: string | null;
  blockHeight: string | null;
  epochNumber: string | null;
  chainId: string | null;
}

function getLocalCoreRpcUrl(): string {
  return appAbsoluteUrl('core-rpc');
}

export const CORE_CHAIN_CONFIGS: Record<number, CoreChainConfig> = {
  2029: {
    coreChainId: 2029,
    chainIdHex: '0x7ed',
    label: 'Core Local',
    rpcUrl: 'http://127.0.0.1:12537',
    rpcUrls: ['http://127.0.0.1:12537', 'http://localhost:12537', getLocalCoreRpcUrl()],
  },
  1: {
    coreChainId: 1,
    chainIdHex: '0x1',
    label: 'Core Testnet',
    rpcUrl: 'https://test.confluxrpc.com',
    rpcUrls: ['https://test.confluxrpc.com'],
    blockExplorerUrl: 'https://testnet.confluxscan.io',
  },
  1029: {
    coreChainId: 1029,
    chainIdHex: '0x405',
    label: 'Core Mainnet',
    rpcUrl: 'https://main.confluxrpc.com',
    rpcUrls: ['https://main.confluxrpc.com'],
    blockExplorerUrl: 'https://confluxscan.io',
  },
};

async function addCoreChain(provider: ConfluxProvider, target: CoreChainConfig) {
  let lastError: unknown = null;

  for (const rpcUrl of target.rpcUrls) {
    try {
      const params: {
        chainId: string;
        chainName: string;
        nativeCurrency: { name: string; symbol: string; decimals: number };
        rpcUrls: string[];
        blockExplorerUrls?: string[];
      } = {
        chainId: target.chainIdHex,
        chainName: `Conflux ${target.label}`,
        nativeCurrency: { name: 'Conflux', symbol: 'CFX', decimals: 18 },
        rpcUrls: [rpcUrl],
      };

      if (target.blockExplorerUrl) {
        params.blockExplorerUrls = [target.blockExplorerUrl];
      }

      await provider.request({
        method: 'wallet_addConfluxChain',
        params: [params],
      });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function getCoreChainConfigForEspaceChain(chainId: number): CoreChainConfig {
  if (chainId === 2030) return CORE_CHAIN_CONFIGS[2029];
  if (chainId === 71) return CORE_CHAIN_CONFIGS[1];
  if (chainId === 1030) return CORE_CHAIN_CONFIGS[1029];
  return CORE_CHAIN_CONFIGS[2029];
}

export function createCoreChain(config: CoreChainConfig) {
  return defineChain({
    id: config.coreChainId,
    name: config.label,
    nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
    blockExplorers: config.blockExplorerUrl
      ? {
          default: {
            name: 'ConfluxScan',
            url: config.blockExplorerUrl,
          },
        }
      : undefined,
  });
}

export function createCorePublicClient(config: CoreChainConfig) {
  return createPublicClient({
    chain: createCoreChain(config),
    transport: http(config.rpcUrl, { timeout: 10_000 }),
  });
}

export function normalizeCoreAddressForChain(address: string | null | undefined, chainId: number): CiveAddress | null {
  if (!address) {
    return null;
  }

  try {
    const normalizedInput = address.trim();
    const hexAddress = normalizedInput.startsWith('0x')
      ? normalizedInput as `0x${string}`
      : base32AddressToHex({ address: normalizedInput as CiveAddress });
    return hexAddressToBase32({ hexAddress, networkId: chainId, verbose: false }) as CiveAddress;
  } catch {
    return null;
  }
}

export function readCoreSnapshot(config: CoreChainConfig, address?: string | null): Promise<CoreSnapshot> {
  const client = createCorePublicClient(config);
  const normalizedAddress = normalizeCoreAddressForChain(address, config.coreChainId);

  return Promise.all([
    client.getStatus(),
    client.getBlock({ epochTag: 'latest_state' }),
    normalizedAddress ? client.getBalance({ address: normalizedAddress }) : Promise.resolve(null),
  ]).then(([status, block, balance]) => ({
    balanceCFX: typeof balance === 'bigint' ? formatCFX(balance) : null,
    blockHeight: block?.height != null ? String(block.height) : null,
    epochNumber: status?.epochNumber != null ? String(status.epochNumber) : null,
    chainId: status?.chainId != null ? String(status.chainId) : null,
  }));
}

export function getCoreChainLabel(chainId: string | null): string {
  switch (chainId?.toLowerCase()) {
    case '0x7ed':
      return 'Conflux Core Local';
    case '0x1':
      return 'Conflux Core Testnet';
    case '0x405':
      return 'Conflux Core Mainnet';
    default:
      return chainId ?? 'Unavailable';
  }
}

export function useCoreWallet() {
  const provider = useMemo(() => getConfluxProvider(), []);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);

  const getWalletClient = (target: CoreChainConfig) => {
    if (!provider) {
      return null;
    }

    return createWalletClient({
      chain: createCoreChain(target),
      transport: custom(provider),
    });
  };

  const getPublicClient = (target: CoreChainConfig) => createCorePublicClient(target);

  const refresh = async () => {
    if (!provider) {
      setAddress(null);
      setChainId(null);
      return;
    }

    setIsRefreshing(true);
    setError(null);

    try {
      const [accounts, nextChainId] = await Promise.all([
        requestNoParams(provider, 'cfx_accounts').catch(() => []),
        requestNoParams(provider, 'cfx_chainId').catch(() => null),
      ]);

      setAddress(getFirstAccount(accounts));
      setChainId(getChainId(nextChainId));
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setIsRefreshing(false);
    }
  };

  const connect = async () => {
    if (!provider) {
      setError('Fluent Core wallet was not detected in this browser.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const accounts = await requestNoParams(provider, 'cfx_requestAccounts');
      setAddress(getFirstAccount(accounts));

      const nextChainId = await requestNoParams(provider, 'cfx_chainId').catch(() => null);
      setChainId(getChainId(nextChainId));
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setIsConnecting(false);
    }
  };

  const switchChain = async (target: CoreChainConfig) => {
    if (!provider) {
      setError('Fluent Core wallet was not detected in this browser.');
      return;
    }

    setIsSwitching(true);
    setError(null);

    try {
      await provider.request({
        method: 'wallet_switchConfluxChain',
        params: [{ chainId: target.chainIdHex }],
      });
    } catch (switchError) {
      await addCoreChain(provider, target).catch((addError) => {
        throw addError ?? switchError;
      });
      await provider.request({
        method: 'wallet_switchConfluxChain',
        params: [{ chainId: target.chainIdHex }],
      });
    }

    try {
      const nextChainId = await requestNoParams(provider, 'cfx_chainId').catch(() => null);
      setChainId(getChainId(nextChainId));
    } catch (nextError) {
      setError(formatError(nextError));
    } finally {
      setIsSwitching(false);
    }
  };

  useEffect(() => {
    if (!provider) {
      return;
    }

    const handleAccountsChanged = (accounts: unknown) => {
      setAddress(getFirstAccount(accounts));
    };

    const handleChainChanged = (nextChainId: unknown) => {
      setChainId(getChainId(nextChainId));
    };

    provider.on?.('accountsChanged', handleAccountsChanged);
    provider.on?.('chainChanged', handleChainChanged);
    void refresh();

    return () => {
      provider.removeListener?.('accountsChanged', handleAccountsChanged);
      provider.removeListener?.('chainChanged', handleChainChanged);
    };
  }, [provider]);

  return {
    address,
    chainId,
    error,
    isAvailable: !!provider,
    isConnecting,
    isConnected: !!address,
    isRefreshing,
    isSwitching,
    refresh,
    connect,
    switchChain,
    getWalletClient,
    getPublicClient,
  };
}