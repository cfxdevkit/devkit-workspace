import { PROJECT_NETWORK, PROJECT_DEFAULT_CHAIN_ID } from './generated/project-network.js';
import { devkitTarget } from './generated/devkit-target.js';
import { appUrl } from './app-base.js';

export function getRuntimeSnapshot() {
  return {
    network: PROJECT_NETWORK.network,
    chainId: PROJECT_DEFAULT_CHAIN_ID,
    target: devkitTarget,
    rpcUrl: appUrl('rpc'),
    backendUrl: appUrl('api'),
  };
}
