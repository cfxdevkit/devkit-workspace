import type { CurrentNetwork } from '@cfxdevkit/shared';
import type { NetworkSelection } from './network-state';

function includesAny(value: string | undefined, needles: string[]): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return needles.some((needle) => normalized.includes(needle));
}

export function resolveNetworkSelection(current: Pick<CurrentNetwork, 'mode' | 'chainId' | 'evmChainId' | 'public'>): NetworkSelection | null {
  if (current.mode === 'local') {
    return 'local';
  }

  if (current.chainId === 1 || current.evmChainId === 71) {
    return 'testnet';
  }

  if (current.chainId === 1029 || current.evmChainId === 1030) {
    return 'mainnet';
  }

  if (
    includesAny(current.public?.coreRpcUrl, ['testnet', 'test.confluxrpc']) ||
    includesAny(current.public?.evmRpcUrl, ['evmtestnet', 'testnet'])
  ) {
    return 'testnet';
  }

  if (
    includesAny(current.public?.coreRpcUrl, ['mainnet', 'main.confluxrpc']) ||
    includesAny(current.public?.evmRpcUrl, ['evm.confluxrpc', 'mainnet'])
  ) {
    return 'mainnet';
  }

  return null;
}