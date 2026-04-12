/**
 * clients/conflux-client.ts
 *
 * Extension-side API client abstraction — mirrors the DevkitClient shape in
 * packages/mcp-server/src/clients/devkit-client.ts so both orchestration
 * surfaces stay structurally aligned.
 *
 * All API calls are delegated to conflux/api.ts which resolves the port from
 * the VS Code workspace configuration and adds VS Code–specific signal/timeout
 * handling.
 */

import {
  deployBootstrap,
  deployTemplate,
  fundAccount as apiFundAccount,
  generateMnemonic,
  getAccounts,
  getBootstrapCatalog,
  getBootstrapEntry,
  getContractTemplates,
  getDeployedContracts,
  getKeystoreStatus,
  getMiningStatus,
  getNetworkConfig,
  getNodeStatus,
  getRpcUrls,
  isServerOnline,
  mine,
  registerDeployedContract,
  restartNode,
  restartWipe,
  setupKeystoreWallet,
  startMining,
  startNode,
  stopMining,
  stopNode,
  unlockKeystoreWallet,
  wipe,
} from '../conflux/api';

export type {
  KeystoreStatus,
  NodeStatus,
  AccountInfo,
  DeployedContract,
  MiningStatus,
  RpcUrls,
  NetworkConfig,
} from '../conflux/api';

// ── Server health ──────────────────────────────────────────────────────────

export class ConfluxClient {
  isServerOnline(): Promise<boolean> {
    return isServerOnline();
  }

  // ── Keystore ─────────────────────────────────────────────────────────────

  getKeystoreStatus() {
    return getKeystoreStatus();
  }

  generateMnemonic() {
    return generateMnemonic();
  }

  setupKeystore(mnemonic: string, label: string, options?: { accountsCount?: number }) {
    return setupKeystoreWallet(mnemonic, label, options);
  }

  unlockKeystore(password: string) {
    return unlockKeystoreWallet(password);
  }

  // ── Node lifecycle ────────────────────────────────────────────────────────

  getNodeStatus() {
    return getNodeStatus();
  }

  startNode() {
    return startNode();
  }

  stopNode() {
    return stopNode();
  }

  restartNode() {
    return restartNode();
  }

  wipeRestart() {
    return restartWipe();
  }

  wipeNode() {
    return wipe();
  }

  // ── Network & accounts ────────────────────────────────────────────────────

  getRpcUrls() {
    return getRpcUrls();
  }

  getNetworkConfig() {
    return getNetworkConfig();
  }

  getAccounts() {
    return getAccounts();
  }

  fundAccount(address: string, amount: string, chain?: 'core' | 'evm') {
    return apiFundAccount(address, amount, chain);
  }

  // ── Mining ────────────────────────────────────────────────────────────────

  mine(blocks: number) {
    return mine(blocks);
  }

  getMiningStatus() {
    return getMiningStatus();
  }

  startMining(intervalMs: number) {
    return startMining(intervalMs);
  }

  stopMining() {
    return stopMining();
  }

  // ── Contracts ─────────────────────────────────────────────────────────────

  getContractTemplates() {
    return getContractTemplates();
  }

  deployTemplate(
    name: string,
    abi: unknown[],
    bytecode: string,
    args: unknown[],
    chain: 'evm' | 'core',
    signer?: { accountIndex?: number; privateKey?: string; rpcUrl?: string; chainId?: number },
  ) {
    return deployTemplate(name, abi, bytecode, args, chain, signer);
  }

  getDeployedContracts() {
    return getDeployedContracts();
  }

  registerDeployedContract(payload: Parameters<typeof registerDeployedContract>[0]) {
    return registerDeployedContract(payload);
  }

  getBootstrapCatalog() {
    return getBootstrapCatalog();
  }

  getBootstrapEntry(name: string) {
    return getBootstrapEntry(name);
  }

  deployBootstrap(
    name: string,
    args: unknown[],
    chain: 'evm' | 'core',
    signer?: { accountIndex?: number; privateKey?: string; rpcUrl?: string; chainId?: number },
  ) {
    return deployBootstrap(name, args, chain, signer);
  }
}
