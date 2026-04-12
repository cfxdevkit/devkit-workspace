import { defineChain } from 'viem';
import { appUrl } from './app-base';

export const confluxLocalESpace = defineChain({
  id: 2030,
  name: 'Conflux eSpace (Local)',
  nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
  rpcUrls: {
    default: { http: [appUrl('rpc')] },
  },
});

export const confluxTestnetESpace = defineChain({
  id: 71,
  name: 'Conflux eSpace (Testnet)',
  nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evmtestnet.confluxrpc.com'] },
  },
  blockExplorers: {
    default: { name: 'ConfluxScan Testnet', url: 'https://evmtestnet.confluxscan.io' },
  },
  testnet: true,
});

export const confluxMainnetESpace = defineChain({
  id: 1030,
  name: 'Conflux eSpace',
  nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://evm.confluxrpc.com'] },
  },
  blockExplorers: {
    default: { name: 'ConfluxScan', url: 'https://evm.confluxscan.io' },
  },
});

export const SUPPORTED_CHAINS = [confluxLocalESpace, confluxTestnetESpace, confluxMainnetESpace] as const;

export function isSupportedChainId(chainId: number): boolean {
  return SUPPORTED_CHAINS.some((c) => c.id === chainId);
}

export function getChainLabel(chainId: number): string {
  if (chainId === confluxLocalESpace.id) return 'eSpace Local';
  if (chainId === confluxTestnetESpace.id) return 'eSpace Testnet';
  if (chainId === confluxMainnetESpace.id) return 'eSpace';
  return `Chain ${chainId}`;
}
