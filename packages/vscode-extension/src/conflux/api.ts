/**
 * api.ts
 *
 * VS Code adapter for the conflux-devkit REST API.
 * All types are imported from @cfxdevkit/shared (single source of truth).
 * Port is resolved from VS Code workspace configuration.
 */

import * as vscode from 'vscode';

// Import types locally (compile-time only — erased at runtime)
import type {
  KeystoreStatus,
  NodeStatus,
  AccountInfo,
  TemplateInfo,
  CompiledContract,
  BootstrapEntry,
  DeployedContract,
  CurrentNetwork,
  NetworkCapabilities,
  NetworkMode,
  NetworkConfig,
  PublicNetworkConfig,
  RpcUrls,
  MiningStatus,
} from '@cfxdevkit/shared';

// Re-export all types from shared — no duplication
export type {
  KeystoreStatus,
  NodeStatus,
  AccountInfo,
  WalletEntry,
  MiningStatus,
  RpcUrls,
  NetworkConfig,
  TemplateInfo,
  CompiledContract,
  BootstrapEntry,
  DeployedContract,
  CurrentNetwork,
  NetworkCapabilities,
  NetworkMode,
  PublicNetworkConfig,
} from '@cfxdevkit/shared';

// ── VS Code port resolver ──────────────────────────────────────────────────

function getBaseUrl(): string {
  const port = vscode.workspace.getConfiguration('cfxdevkit').get<number>('port') ?? 7748;
  return `http://127.0.0.1:${port}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(10_000),
  });
  const body = await res.json() as T;
  if (!res.ok) {
    const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

// ── Server health ──────────────────────────────────────────────────────────

export async function isServerOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/health`, { signal: AbortSignal.timeout(2_000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Keystore ───────────────────────────────────────────────────────────────

export async function getKeystoreStatus(): Promise<KeystoreStatus> {
  return apiFetch<KeystoreStatus>('/api/keystore/status');
}

export async function generateMnemonic(): Promise<string> {
  const res = await apiFetch<{ mnemonic: string }>('/api/keystore/generate', {
    method: 'POST', body: '{}',
  });
  return res.mnemonic;
}

export async function setupKeystoreWallet(
  mnemonic: string,
  label = 'Default',
  options?: { accountsCount?: number }
): Promise<void> {
  await apiFetch('/api/keystore/setup', {
    method: 'POST',
    body: JSON.stringify({ mnemonic, label, ...(options ?? {}) }),
  });
}

export async function unlockKeystoreWallet(password: string): Promise<void> {
  await apiFetch('/api/keystore/unlock', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

// ── Node lifecycle ─────────────────────────────────────────────────────────

export async function getNodeStatus(): Promise<NodeStatus> {
  return apiFetch<NodeStatus>('/api/node/status');
}

export async function startNode(): Promise<NodeStatus> {
  const res = await apiFetch<{ ok: boolean; status: NodeStatus }>('/api/node/start', {
    method: 'POST', body: '{}',
    signal: AbortSignal.timeout(75_000), // xcfx binary startup: up to 60s
  });
  return res.status;
}

export async function stopNode(): Promise<void> {
  await apiFetch('/api/node/stop', { method: 'POST', body: '{}' });
}

export async function restartNode(): Promise<NodeStatus> {
  const res = await apiFetch<{ ok: boolean; status: NodeStatus }>('/api/node/restart', {
    method: 'POST', body: '{}',
    signal: AbortSignal.timeout(75_000), // stop (<5s) + xcfx restart (up to 60s)
  });
  return res.status;
}

export async function restartWipe(): Promise<NodeStatus> {
  const res = await apiFetch<{ ok: boolean; status: NodeStatus }>('/api/node/restart-wipe', {
    method: 'POST', body: '{}',
    signal: AbortSignal.timeout(90_000), // stop + wipe files + fresh xcfx init (can be slower)
  });
  return res.status;
}

export async function wipe(): Promise<void> {
  await apiFetch('/api/node/wipe', { method: 'POST', body: '{}',
    signal: AbortSignal.timeout(30_000), // stop + delete files only, no restart
  });
}

// ── Accounts ───────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<AccountInfo[]> {
  return apiFetch<AccountInfo[]>('/api/accounts');
}

// ── Contracts ──────────────────────────────────────────────────────────────

export async function getContractTemplates(): Promise<TemplateInfo[]> {
  return apiFetch<TemplateInfo[]>('/api/contracts/templates');
}

export async function compileContract(
  source: string,
  contractName?: string
): Promise<CompiledContract> {
  return apiFetch<CompiledContract>('/api/contracts/compile', {
    method: 'POST',
    body: JSON.stringify({ source, contractName }),
    signal: AbortSignal.timeout(30_000),
  });
}

export async function deployTemplate(
  name: string,
  abi: unknown[],
  bytecode: string,
  args: unknown[],
  chain: 'evm' | 'core',
  signer?: { accountIndex?: number; privateKey?: string; rpcUrl?: string; chainId?: number }
): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/contracts/deploy', {
    method: 'POST',
    body: JSON.stringify({ contractName: name, abi, bytecode, args, chain, accountIndex: 0, ...(signer ?? {}) }),
    // deployEvm transport: 30s + packMine Core transport: 120s
    signal: AbortSignal.timeout(150_000),
  });
}

export async function getDeployedContracts(): Promise<DeployedContract[]> {
  return apiFetch<DeployedContract[]>('/api/contracts/deployed');
}

export async function registerDeployedContract(payload: {
  id?: string;
  name: string;
  address: string;
  chain: 'evm' | 'core';
  chainId: number;
  txHash?: string;
  deployer?: string;
  deployedAt?: string;
  abi?: unknown[];
  constructorArgs?: unknown[];
  metadata?: Record<string, unknown>;
}): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/contracts/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Network mode ───────────────────────────────────────────────────────────

export async function getCurrentNetwork(): Promise<CurrentNetwork> {
  return apiFetch<CurrentNetwork>('/api/network/current');
}

export async function setCurrentNetwork(payload: {
  mode?: NetworkMode;
  public?: PublicNetworkConfig;
}): Promise<CurrentNetwork> {
  return apiFetch<CurrentNetwork>('/api/network/current', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function getNetworkCapabilities(): Promise<NetworkCapabilities> {
  return apiFetch<NetworkCapabilities>('/api/network/capabilities');
}

export async function callDeployedContract(
  contractId: string,
  functionName: string,
  args: unknown[],
  accountIndex = 0,
  privateKey?: string,
): Promise<{ success: boolean; result?: unknown; txHash?: string; blockNumber?: string; status?: string }> {
  return apiFetch(`/api/contracts/${encodeURIComponent(contractId)}/call`, {
    method: 'POST',
    body: JSON.stringify({ functionName, args, accountIndex, ...(privateKey ? { privateKey } : {}) }),
    signal: AbortSignal.timeout(60_000),
  });
}

// ── Bootstrap catalog ──────────────────────────────────────────────────────

export async function getBootstrapCatalog(): Promise<BootstrapEntry[]> {
  return apiFetch<BootstrapEntry[]>('/api/bootstrap/catalog');
}

export async function getBootstrapEntry(name: string): Promise<BootstrapEntry> {
  return apiFetch<BootstrapEntry>(`/api/bootstrap/catalog/${encodeURIComponent(name)}`);
}

export async function deployBootstrap(
  name: string,
  args: unknown[],
  chain: 'evm' | 'core',
  signer?: { accountIndex?: number; privateKey?: string; rpcUrl?: string; chainId?: number }
): Promise<DeployedContract> {
  return apiFetch<DeployedContract>('/api/bootstrap/deploy', {
    method: 'POST',
    body: JSON.stringify({ name, args, chain, accountIndex: 0, ...(signer ?? {}) }),
    // deployEvm transport: 30s + packMine Core transport: 120s
    signal: AbortSignal.timeout(150_000),
  });
}

// ── Mining ─────────────────────────────────────────────────────────────────

export async function mine(blocks: number): Promise<void> {
  await apiFetch('/api/mining/mine', {
    method: 'POST',
    body: JSON.stringify({ blocks }),
  });
}

export async function getMiningStatus(): Promise<MiningStatus> {
  return apiFetch<MiningStatus>('/api/mining/status');
}

export async function startMining(intervalMs = 2000): Promise<MiningStatus> {
  const res = await apiFetch<{ ok: boolean; status: MiningStatus }>('/api/mining/start', {
    method: 'POST',
    body: JSON.stringify({ intervalMs }),
  });
  return res.status;
}

export async function stopMining(): Promise<MiningStatus> {
  const res = await apiFetch<{ ok: boolean; status: MiningStatus }>('/api/mining/stop', {
    method: 'POST',
    body: '{}',
  });
  return res.status;
}

// ── Funding ────────────────────────────────────────────────────────────────

export async function fundAccount(
  address: string,
  amount: string,
  chain?: 'core' | 'evm',
): Promise<{ ok: boolean; txHash: string; confirmed: boolean; message: string }> {
  return apiFetch('/api/accounts/fund', {
    method: 'POST',
    body: JSON.stringify({ address, amount, chain }),
    signal: AbortSignal.timeout(40_000),
  });
}

// ── RPC URLs & network config ──────────────────────────────────────────────

export async function getRpcUrls(): Promise<RpcUrls> {
  return apiFetch<RpcUrls>('/api/network/rpc-urls');
}

export async function getNetworkConfig(): Promise<NetworkConfig> {
  return apiFetch<NetworkConfig>('/api/network/config');
}
