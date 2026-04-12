import {
  deployBootstrapContract,
  deployContractTemplate,
  getContractTemplate,
  fundAccount,
  generateMnemonicWords,
  getAccounts,
  getBootstrapCatalog,
  getBootstrapEntry,
  getContractTemplates,
  getDeployedContracts,
  getFullStatus,
  getKeystoreStatus,
  getMiningStatus,
  getNetworkConfig,
  getNodeStatus,
  getRpcUrls,
  getWallets,
  isDevkitServerRunning,
  mine,
  restartNode,
  restartWipeNode,
  setupKeystore,
  startMining,
  startNode,
  stopMining,
  stopNode,
  unlockKeystore,
  wipeNodeData,
} from '@cfxdevkit/shared';
import type { DevkitConfig } from '@cfxdevkit/shared';

export class DevkitClient {
  isServerRunning(config?: DevkitConfig): Promise<boolean> {
    return isDevkitServerRunning(config);
  }

  getStatus(config?: DevkitConfig) {
    return getFullStatus(config);
  }

  getNodeStatus(config?: DevkitConfig) {
    return getNodeStatus(config);
  }

  getKeystoreStatus(config?: DevkitConfig) {
    return getKeystoreStatus(config);
  }

  generateMnemonicWords(config?: DevkitConfig) {
    return generateMnemonicWords(config);
  }

  setupKeystore(mnemonic: string, label: string, password?: string, config?: DevkitConfig) {
    return setupKeystore(mnemonic, label, password, config);
  }

  unlockKeystore(password: string, config?: DevkitConfig) {
    return unlockKeystore(password, config);
  }

  getWallets(config?: DevkitConfig) {
    return getWallets(config);
  }

  getContractTemplates(config?: DevkitConfig) {
    return getContractTemplates(config);
  }

  getContractTemplate(name: string, config?: DevkitConfig) {
    return getContractTemplate(name, config);
  }

  deployContractTemplate(
    contractName: string,
    contractArgs: unknown[],
    chain: 'evm' | 'core',
    accountIndex: number,
    config?: DevkitConfig,
  ) {
    return deployContractTemplate(contractName, contractArgs, chain, accountIndex, config);
  }

  getDeployedContracts(config?: DevkitConfig) {
    return getDeployedContracts(config);
  }

  getBootstrapCatalog(config?: DevkitConfig) {
    return getBootstrapCatalog(config);
  }

  getBootstrapEntry(name: string, config?: DevkitConfig) {
    return getBootstrapEntry(name, config);
  }

  deployBootstrapContract(
    name: string,
    args: unknown[],
    chain: 'evm' | 'core',
    accountIndex: number,
    config?: DevkitConfig,
  ) {
    return deployBootstrapContract(name, args, chain, accountIndex, config);
  }

  getRpcUrls(config?: DevkitConfig) {
    return getRpcUrls(config);
  }

  getNetworkConfig(config?: DevkitConfig) {
    return getNetworkConfig(config);
  }

  getAccounts(config?: DevkitConfig) {
    return getAccounts(config);
  }

  fundAccount(address: string, amount: string, chain: 'core' | 'evm' | undefined, config?: DevkitConfig) {
    return fundAccount(address, amount, chain, config);
  }

  mine(blocks: number, config?: DevkitConfig) {
    return mine(blocks, config);
  }

  getMiningStatus(config?: DevkitConfig) {
    return getMiningStatus(config);
  }

  startMining(intervalMs: number, config?: DevkitConfig) {
    return startMining(intervalMs, config);
  }

  stopMining(config?: DevkitConfig) {
    return stopMining(config);
  }

  startNode(config?: DevkitConfig) {
    return startNode(config);
  }

  stopNode(config?: DevkitConfig) {
    return stopNode(config);
  }

  restartNode(config?: DevkitConfig) {
    return restartNode(config);
  }

  restartWipeNode(config?: DevkitConfig) {
    return restartWipeNode(config);
  }

  wipeNodeData(config?: DevkitConfig) {
    return wipeNodeData(config);
  }
}
