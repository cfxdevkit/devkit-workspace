import { PROJECT_DEFAULT_CHAIN_ID } from './generated/project-network.js';

export const SUPPORTED_CHAINS = [
  { id: 2030, name: 'Conflux eSpace (Local)', shortLabel: 'eSpace Local' },
  { id: 71, name: 'Conflux eSpace Testnet', shortLabel: 'eSpace Testnet' },
  { id: 1030, name: 'Conflux eSpace Mainnet', shortLabel: 'eSpace Mainnet' },
];

export function getChainLabel(chainId) {
  return SUPPORTED_CHAINS.find((chain) => chain.id === chainId)?.shortLabel ?? `Chain ${chainId}`;
}

export function getDefaultChainLabel() {
  return getChainLabel(PROJECT_DEFAULT_CHAIN_ID);
}
