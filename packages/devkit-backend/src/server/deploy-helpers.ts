/**
 * deploy-helpers.ts
 *
 * Shared EVM / Core Space deployment primitives used by both the contracts
 * route and the bootstrap route.  Keeping them here avoids duplication and
 * makes it easy to maintain consistent gas limits, receipt-polling strategy,
 * and mining logic in a single place.
 */

import {
  getChainConfig,
  isValidChainId,
  type SupportedChainId,
  toCiveChain,
  toViemChain,
} from '@cfxdevkit/core/config';
import { contractStorage } from './contract-storage.js';
import type { NodeManager } from './node-manager.js';

// ── Utilities ──────────────────────────────────────────────────────────────

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

// ── EVM deployment helper ──────────────────────────────────────────────────

export async function deployEvm(params: {
  bytecode: `0x${string}`;
  abi: unknown[];
  args: unknown[];
  privateKey: `0x${string}`;
  rpcUrl: string;
  chainId: number;
}): Promise<{
  hash: `0x${string}`;
  pollReceipt: () => Promise<string | null>;
}> {
  const {
    createPublicClient,
    createWalletClient,
    http,
    encodeDeployData,
    defineChain,
  } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');

  const evmChain = isValidChainId(params.chainId)
    ? toViemChain(getChainConfig(params.chainId as SupportedChainId))
    : defineChain({
        id: params.chainId,
        name: 'Conflux eSpace local',
        nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
        rpcUrls: { default: { http: [params.rpcUrl] } },
      });

  const account = privateKeyToAccount(params.privateKey);

  const walletClient = createWalletClient({
    account,
    chain: evmChain,
    transport: http(params.rpcUrl, { timeout: 30_000 }),
  });

  // Encode deployment data manually and use sendTransaction with an explicit
  // gas limit.  This bypasses viem's eth_estimateGas pre-flight call, which
  // Conflux eSpace can reject with a false "execution reverted" on construction.
  const deployData = encodeDeployData({
    abi: params.abi,
    bytecode: params.bytecode,
    args: params.args,
  });

  const hash = await walletClient.sendTransaction({
    data: deployData,
    gas: 5_000_000n,
  });

  const publicClient = createPublicClient({
    chain: evmChain,
    transport: http(params.rpcUrl, { timeout: 30_000 }),
  });

  // pollReceipt: returns contractAddress when mined, null if not yet available
  const pollReceipt = async (): Promise<string | null> => {
    const receipt = await publicClient
      .getTransactionReceipt({ hash })
      .catch(() => null);
    if (!receipt) return null;
    if (receipt.status === 'reverted') throw new Error('EVM deploy reverted');
    return receipt.contractAddress ?? null;
  };

  return { hash, pollReceipt };
}

// ── Core Space deployment helper ───────────────────────────────────────────

export async function deployCore(params: {
  bytecode: `0x${string}`;
  abi: unknown[];
  args: unknown[];
  privateKey: `0x${string}`;
  rpcUrl: string;
  chainId: number;
}): Promise<{
  hash: `0x${string}`;
  pollReceipt: () => Promise<string | null>;
}> {
  const cive = await import('cive');
  const { privateKeyToAccount } = await import('cive/accounts');

  const coreChain = isValidChainId(params.chainId)
    ? toCiveChain(getChainConfig(params.chainId as SupportedChainId))
    : (() => {
        // biome-ignore lint/suspicious/noExplicitAny: dynamic fallback
        const { defineChain } = cive as any;
        return defineChain({
          id: params.chainId,
          name: 'Conflux Core local',
          nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
          rpcUrls: { default: { http: [params.rpcUrl] } },
        });
      })();

  const account = privateKeyToAccount(params.privateKey, {
    networkId: params.chainId,
  });

  const walletClient = cive.createWalletClient({
    account,
    chain: coreChain,
    transport: cive.http(params.rpcUrl, { timeout: 30_000 }),
  });

  const hash = await walletClient.deployContract({
    chain: coreChain,
    // biome-ignore lint/suspicious/noExplicitAny: heterogeneous ABI types
    abi: params.abi as any[],
    bytecode: params.bytecode,
    // biome-ignore lint/suspicious/noExplicitAny: constructor args are unknown at compile time
    args: params.args as any[],
    gas: 5_000_000n,
  });

  const publicClient = cive.createPublicClient({
    chain: coreChain,
    transport: cive.http(params.rpcUrl, { timeout: 30_000 }),
  });

  // pollReceipt: returns contractCreated address when mined, null if not yet available
  const pollReceipt = async (): Promise<string | null> => {
    const receipt = await publicClient
      .getTransactionReceipt({ hash })
      .catch(() => null);
    if (!receipt) return null;
    const address =
      (receipt as unknown as { contractCreated?: string }).contractCreated ??
      (receipt as unknown as { contractAddress?: string }).contractAddress;
    return address ?? null;
  };

  return { hash, pollReceipt };
}

// ── Orchestration ──────────────────────────────────────────────────────────

export interface OrchestrateDeployParams {
  bytecode: string;
  // biome-ignore lint/suspicious/noExplicitAny: ABI is heterogeneous
  abi: any[];
  // biome-ignore lint/suspicious/noExplicitAny: constructor args are unknown
  args: any[];
  chain: 'evm' | 'core';
  accountIndex: number;
  contractName: string;
  nodeManager: NodeManager;
}

export interface OrchestrateDeployResult {
  address: string;
  txHash: string;
  chain: 'evm' | 'core';
  id: string;
}

/**
 * Full deploy orchestration: send tx → packMine → poll receipt → persist.
 * Used by both `contracts` and `bootstrap` routes.
 */
export async function orchestrateDeploy({
  bytecode,
  abi,
  args,
  chain,
  accountIndex,
  contractName,
  nodeManager,
}: OrchestrateDeployParams): Promise<OrchestrateDeployResult> {
  const manager = nodeManager.requireManager();
  const accounts = manager.getAccounts();
  const account = accounts[accountIndex];
  if (!account) {
    throw new Error(`Account index ${accountIndex} not found`);
  }

  const rpcUrls = manager.getRpcUrls();
  const cfg = nodeManager.getConfig();

  let address: string;
  let txHash: string;

  if (chain === 'evm') {
    const { hash, pollReceipt } = await deployEvm({
      bytecode: bytecode as `0x${string}`,
      abi,
      args,
      privateKey: (account.evmPrivateKey ??
        account.privateKey) as `0x${string}`,
      rpcUrl: rpcUrls.evm,
      chainId: cfg.evmChainId ?? 2030,
    });
    txHash = hash;

    // EVM (eSpace) transactions are only packed via mine({ numTxs }),
    // NOT by mine({ blocks }).  Call packMine() once to submit the tx
    // into a block (generates 5 Core blocks internally), then loop with
    // mine({ blocks:1 }) to advance deferred-execution epochs until the
    // receipt appears (per xcfx-node reference test pattern, up to 30 retries).
    await manager.packMine();
    let receiptAddress: string | null = null;
    for (let i = 0; i < 30; i++) {
      receiptAddress = await pollReceipt().catch(() => null);
      if (receiptAddress) break;
      await manager.mine(1);
      await sleep(300);
    }
    if (!receiptAddress) {
      throw new Error(
        'Deploy timed out — receipt not found after packMine + 30 blocks'
      );
    }
    address = receiptAddress;
  } else {
    const { hash, pollReceipt } = await deployCore({
      bytecode: bytecode as `0x${string}`,
      abi,
      args,
      privateKey: account.privateKey as `0x${string}`,
      rpcUrl: rpcUrls.core,
      chainId: cfg.chainId ?? 2029,
    });
    txHash = hash;

    // With devPackTxImmediately:false, Core txs are also only packed by
    // mine({ numTxs:1 }), same as eSpace. Call packMine() then poll.
    await manager.packMine();
    let receiptAddress: string | null = null;
    for (let i = 0; i < 30; i++) {
      receiptAddress = await pollReceipt().catch(() => null);
      if (receiptAddress) break;
      await manager.mine(1);
      await sleep(200);
    }
    if (!receiptAddress) {
      throw new Error('Deploy timed out — receipt not found after 30 blocks');
    }
    address = receiptAddress;
  }

  // Persist to wallet-scoped contracts.json
  const stored = contractStorage.add({
    id: `${chain}-${Date.now()}`,
    name: contractName,
    address,
    chain,
    chainId: chain === 'evm' ? (cfg.evmChainId ?? 2030) : (cfg.chainId ?? 2029),
    txHash,
    deployer: chain === 'evm' ? account.evmAddress : account.coreAddress,
    deployedAt: new Date().toISOString(),
    abi,
    constructorArgs: args,
  });

  return { address, txHash, chain, id: stored.id };
}
