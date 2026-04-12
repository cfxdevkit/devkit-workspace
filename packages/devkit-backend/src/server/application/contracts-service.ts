import {
  getChainConfig,
  isValidChainId,
  type SupportedChainId,
  toCiveChain,
  toViemChain,
} from '@cfxdevkit/core/config';
import type { Address as CiveAddress } from 'cive';
import { contractStorage, type StoredContract } from '../contract-storage.js';
import { deployCore, deployEvm, orchestrateDeploy, sleep } from '../deploy-helpers.js';
import type { NodeManager } from '../node-manager.js';

export class ContractsApplicationService {
  constructor(private readonly nodeManager: NodeManager) {}

  async deploy(params: {
    bytecode: string;
    abi: unknown[];
    args?: unknown[];
    chain?: 'core' | 'evm';
    accountIndex?: number;
    contractName?: string;
    privateKey?: string;
    rpcUrl?: string;
    chainId?: number;
  }): Promise<Record<string, unknown>> {
    const {
      bytecode,
      abi,
      args = [],
      chain = 'evm',
      accountIndex = 0,
      contractName = 'Contract',
      privateKey,
      rpcUrl,
      chainId,
    } = params;

    const network = this.nodeManager.getNetworkProfile();
    const effectiveChainIds = this.nodeManager.getEffectiveChainIds();

    if (network.mode === 'public') {
      const signer = await this.nodeManager.resolveSignerForPublicMode({
        chain,
        accountIndex,
        requestPrivateKey: privateKey,
      });

      const resolvedRpcUrl =
        rpcUrl ??
        (chain === 'evm' ? network.public.evmRpcUrl : network.public.coreRpcUrl);
      if (!resolvedRpcUrl) {
        throw new Error(
          chain === 'evm'
            ? 'Missing evmRpcUrl in network profile or request body'
            : 'Missing coreRpcUrl in network profile or request body'
        );
      }

      const resolvedChainId =
        chainId ??
        (chain === 'evm' ? effectiveChainIds.evmChainId : effectiveChainIds.chainId);

      let address: string;
      let txHash: string;
      if (chain === 'evm') {
        const { hash, pollReceipt } = await deployEvm({
          bytecode: bytecode as `0x${string}`,
          abi,
          args,
          privateKey: signer.privateKey,
          rpcUrl: resolvedRpcUrl,
          chainId: resolvedChainId,
        });
        txHash = hash;

        let receiptAddress: string | null = null;
        for (let i = 0; i < 30; i++) {
          receiptAddress = await pollReceipt().catch(() => null);
          if (receiptAddress) break;
          await sleep(800);
        }
        if (!receiptAddress) {
          throw new Error('Deploy timed out — receipt not found after 30 polls');
        }
        address = receiptAddress;
      } else {
        const { hash, pollReceipt } = await deployCore({
          bytecode: bytecode as `0x${string}`,
          abi,
          args,
          privateKey: signer.privateKey,
          rpcUrl: resolvedRpcUrl,
          chainId: resolvedChainId,
        });
        txHash = hash;

        let receiptAddress: string | null = null;
        for (let i = 0; i < 30; i++) {
          receiptAddress = await pollReceipt().catch(() => null);
          if (receiptAddress) break;
          await sleep(800);
        }
        if (!receiptAddress) {
          throw new Error('Deploy timed out — receipt not found after 30 polls');
        }
        address = receiptAddress;
      }

      const deployer = await this.deriveAddressFromPrivateKey(
        chain,
        signer.privateKey,
        resolvedChainId
      );

      const stored = contractStorage.add({
        id: `${chain}-${Date.now()}`,
        name: contractName,
        address,
        chain,
        chainId: resolvedChainId,
        txHash,
        deployer,
        deployedAt: new Date().toISOString(),
        abi,
        constructorArgs: args,
        metadata: {
          mode: 'public',
          rpcUrl: resolvedRpcUrl,
          signerSource: signer.source,
          signerAccountIndex: signer.accountIndex,
        },
      });

      return {
        address,
        txHash,
        chain,
        id: stored.id,
        mode: 'public',
        signerSource: signer.source,
        signerAccountIndex: signer.accountIndex,
      };
    }

    const local = await orchestrateDeploy({
      bytecode,
      abi,
      args,
      chain,
      accountIndex,
      contractName,
      nodeManager: this.nodeManager,
    });
    return { ...local, mode: 'local' };
  }

  list(chain?: 'evm' | 'core'): StoredContract[] {
    return contractStorage.list(chain);
  }

  get(id: string): StoredContract | null {
    return contractStorage.get(id) ?? null;
  }

  delete(id: string): boolean {
    return contractStorage.delete(id);
  }

  clear(): void {
    contractStorage.clear();
  }

  registerExternal(body: Partial<StoredContract>): StoredContract {
    const id = body.id ?? `${body.chain}-${body.address?.toLowerCase()}-${Date.now()}`;
    const stored: StoredContract = {
      id,
      name: body.name as string,
      address: body.address as string,
      chain: body.chain as 'evm' | 'core',
      chainId: body.chainId as number,
      txHash: body.txHash ?? '',
      deployer: body.deployer ?? '',
      deployedAt: body.deployedAt ?? new Date().toISOString(),
      abi: (body.abi as unknown[]) ?? [],
      constructorArgs: (body.constructorArgs as unknown[]) ?? [],
      ...(body.metadata ? { metadata: body.metadata } : {}),
    };
    return contractStorage.add(stored);
  }

  async callContract(params: {
    id: string;
    functionName: string;
    args?: unknown[];
    accountIndex?: number;
    privateKey?: string;
  }): Promise<Record<string, unknown>> {
    const { id, functionName, args = [], accountIndex = 0, privateKey } = params;

    const contract = contractStorage.get(id);
    if (!contract) {
      throw new Error('Contract not found');
    }

    type AbiFunction = {
      type: string;
      name?: string;
      stateMutability?: string;
    };

    const abiItem = (contract.abi as AbiFunction[]).find(
      (item) => item.type === 'function' && item.name === functionName
    );
    if (!abiItem) {
      throw new Error(`Function "${functionName}" not found in ABI`);
    }

    const isRead = abiItem.stateMutability === 'view' || abiItem.stateMutability === 'pure';
    const network = this.nodeManager.getNetworkProfile();
    const chainIds = this.nodeManager.getEffectiveChainIds();

    let manager: ReturnType<NodeManager['requireManager']> | null = null;
    let account: { privateKey: string; evmPrivateKey?: string } | null = null;

    let resolvedRpcUrl: string;
    let resolvedChainId: number;

    if (network.mode === 'local') {
      manager = this.nodeManager.requireManager();

      const localRpcUrls = manager.getRpcUrls();
      resolvedRpcUrl = contract.chain === 'evm' ? localRpcUrls.evm : localRpcUrls.core;
      resolvedChainId = contract.chain === 'evm' ? chainIds.evmChainId : chainIds.chainId;

      const accounts = manager.getAccounts();
      account = accounts[accountIndex] ?? null;
      if (!isRead && !account) {
        throw new Error(`Account index ${accountIndex} not found`);
      }
    } else {
      resolvedRpcUrl =
        contract.chain === 'evm' ? (network.public.evmRpcUrl ?? '') : (network.public.coreRpcUrl ?? '');
      resolvedChainId = contract.chain === 'evm' ? chainIds.evmChainId : chainIds.chainId;

      if (!resolvedRpcUrl) {
        throw new Error(
          contract.chain === 'evm'
            ? 'Missing evmRpcUrl in network profile for public mode'
            : 'Missing coreRpcUrl in network profile for public mode'
        );
      }
    }

    const publicSigner =
      network.mode === 'public' && !isRead
        ? await this.nodeManager.resolveSignerForPublicMode({
            chain: contract.chain,
            accountIndex,
            requestPrivateKey: privateKey,
          })
        : null;

    if (contract.chain === 'evm') {
      const {
        createPublicClient,
        createWalletClient,
        encodeFunctionData,
        http,
        defineChain,
      } = await import('viem');

      const evmChain = isValidChainId(resolvedChainId)
        ? toViemChain(getChainConfig(resolvedChainId as SupportedChainId))
        : defineChain({
            id: resolvedChainId,
            name: 'Conflux eSpace local',
            nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
            rpcUrls: { default: { http: [resolvedRpcUrl] } },
          });

      const publicClient = createPublicClient({
        chain: evmChain,
        transport: http(resolvedRpcUrl, { timeout: 30_000 }),
      });

      if (isRead) {
        const result = await publicClient.readContract({
          address: contract.address as `0x${string}`,
          abi: contract.abi,
          functionName,
          // biome-ignore lint/suspicious/noExplicitAny: ABI args are unknown at runtime
          args: args as any[],
        });
        return { success: true, result: serializeValue(result) };
      }

      const { privateKeyToAccount } = await import('viem/accounts');
      const signerPrivateKey =
        network.mode === 'local'
          ? ((account?.evmPrivateKey ?? account?.privateKey) as `0x${string}` | undefined)
          : (publicSigner?.privateKey as `0x${string}` | undefined);
      if (!signerPrivateKey) {
        throw new Error('No signer private key available for write transaction');
      }

      const walletClient = createWalletClient({
        account: privateKeyToAccount(signerPrivateKey),
        chain: evmChain,
        transport: http(resolvedRpcUrl, { timeout: 30_000 }),
      });

      const data = encodeFunctionData({
        abi: contract.abi,
        functionName,
        // biome-ignore lint/suspicious/noExplicitAny: ABI args are unknown at runtime
        args: args as any[],
      });

      const hash = await walletClient.sendTransaction({
        to: contract.address as `0x${string}`,
        data,
        gas: 500_000n,
      });

      if (network.mode === 'local' && manager) {
        await manager.packMine();
      }
      let receipt = null;
      for (let i = 0; i < 30; i++) {
        receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
        if (receipt) break;
        if (network.mode === 'local' && manager) {
          await manager.mine(1);
        }
        await sleep(300);
      }
      if (!receipt) {
        throw new Error('Transaction timed out — receipt not found after 30 blocks');
      }

      return {
        success: true,
        txHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
      };
    }

    // Core path
    const cive = await import('cive');

    const coreChain = isValidChainId(resolvedChainId)
      ? toCiveChain(getChainConfig(resolvedChainId as SupportedChainId))
      : (() => {
          // biome-ignore lint/suspicious/noExplicitAny: dynamic fallback
          const { defineChain } = cive as any;
          return defineChain({
            id: resolvedChainId,
            name: 'Conflux Core local',
            nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
            rpcUrls: { default: { http: [resolvedRpcUrl] } },
          });
        })();

    const publicClient = cive.createPublicClient({
      chain: coreChain,
      transport: cive.http(resolvedRpcUrl, { timeout: 30_000 }),
    });

    if (isRead) {
      const result = await publicClient.readContract({
        address: contract.address as CiveAddress,
        // biome-ignore lint/suspicious/noExplicitAny: ABI types are heterogeneous
        abi: contract.abi as any[],
        functionName,
        // biome-ignore lint/suspicious/noExplicitAny: ABI args are unknown at runtime
        args: args as any[],
      });
      return { success: true, result: serializeValue(result) };
    }

    const { privateKeyToAccount } = await import('cive/accounts');
    const walletClient = cive.createWalletClient({
      account: privateKeyToAccount(
        (network.mode === 'local'
          ? (account?.privateKey as `0x${string}`)
          : (publicSigner?.privateKey as `0x${string}`)),
        { networkId: resolvedChainId }
      ),
      chain: coreChain,
      transport: cive.http(resolvedRpcUrl, { timeout: 30_000 }),
    });

    const hash = await walletClient.writeContract({
      chain: coreChain,
      address: contract.address as CiveAddress,
      // biome-ignore lint/suspicious/noExplicitAny: ABI types are heterogeneous
      abi: contract.abi as any[],
      functionName,
      // biome-ignore lint/suspicious/noExplicitAny: ABI args are unknown at runtime
      args: args as any[],
      gas: 500_000n,
    });

    if (network.mode === 'local' && manager) {
      await manager.packMine();
    }
    let receipt = null;
    for (let i = 0; i < 30; i++) {
      receipt = await publicClient.getTransactionReceipt({ hash }).catch(() => null);
      if (receipt) break;
      if (network.mode === 'local' && manager) {
        await manager.mine(1);
      }
      await sleep(300);
    }
    if (!receipt) {
      throw new Error('Transaction timed out — receipt not found after 30 blocks');
    }

    const coreReceipt = receipt as unknown as {
      outcomeStatus?: string;
      epochNumber?: bigint;
    };
    return {
      success: true,
      txHash: hash,
      blockNumber: coreReceipt.epochNumber?.toString() ?? 'unknown',
      status: coreReceipt.outcomeStatus === 'success' ? 'success' : 'reverted',
    };
  }

  private async deriveAddressFromPrivateKey(
    chain: 'core' | 'evm',
    privateKey: `0x${string}`,
    chainId: number
  ): Promise<string> {
    if (chain === 'evm') {
      const { privateKeyToAccount } = await import('viem/accounts');
      return privateKeyToAccount(privateKey).address;
    }

    const { privateKeyToAccount } = await import('cive/accounts');
    return privateKeyToAccount(privateKey, {
      networkId: chainId,
    }).address;
  }
}

export function mapDeployErrorStatus(msg: string): number {
  if (msg.includes('not found')) return 400;
  if (msg.includes('Missing evmRpcUrl') || msg.includes('Missing coreRpcUrl')) return 400;
  if (msg.includes('Node') || msg.includes('node')) return 503;
  return 500;
}

// biome-ignore lint/suspicious/noExplicitAny: recursive serialization of unknown return types
function serializeValue(value: any): any {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, serializeValue(v)])
    );
  }
  return value;
}
