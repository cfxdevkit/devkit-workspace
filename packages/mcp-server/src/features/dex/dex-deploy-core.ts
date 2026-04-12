import { EspaceWalletClient, EspaceClient } from '@cfxdevkit/core';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { V2Manifest } from './dex-types.js';

export async function deployV2StackCore(params: {
  accountIndex: number;
  rpcUrl: string;
  chainId: number;
  registrySuffix: string;
  initCodeHash: string;
  getAccount: (index: number) => { evmAddress: string };
  resolvePrivateKey: (index: number, chain: 'espace') => string;
  loadArtifact: (name: string) => ContractArtifact;
  saveContract: (contract: {
    name: string;
    address: string;
    chain: 'evm' | 'core';
    chainId: number;
    deployer: string;
    deployedAt: string;
    abi: unknown[];
    metadata?: Record<string, unknown>;
  }) => Promise<unknown>;
  postManifest: (manifest: V2Manifest) => Promise<void>;
}): Promise<V2Manifest> {
  const {
    accountIndex,
    rpcUrl,
    chainId,
    registrySuffix,
    initCodeHash,
    getAccount,
    resolvePrivateKey,
    loadArtifact,
    saveContract,
    postManifest,
  } = params;

  const account = getAccount(accountIndex);
  const privateKey = resolvePrivateKey(accountIndex, 'espace');

  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const deployer = account.evmAddress;

  const factory = loadArtifact('UniswapV2Factory');
  const factoryAddress = await wallet.deployContract(
    factory.abi,
    factory.bytecode,
    [deployer],
  );
  await saveContract({
    name: `UniswapV2Factory${registrySuffix}`,
    address: factoryAddress,
    chain: 'evm',
    chainId,
    deployer,
    deployedAt: new Date().toISOString(),
    abi: factory.abi,
    metadata: { initCodeHash },
  }).catch(() => {
    // non-fatal
  });

  const weth9 = loadArtifact('WETH9');
  const weth9Address = await wallet.deployContract(
    weth9.abi,
    weth9.bytecode,
    [],
  );
  await saveContract({
    name: `WETH9${registrySuffix}`,
    address: weth9Address,
    chain: 'evm',
    chainId,
    deployer,
    deployedAt: new Date().toISOString(),
    abi: weth9.abi,
  }).catch(() => {
    // non-fatal
  });

  const router = loadArtifact('UniswapV2Router02');
  const routerAddress = await wallet.deployContract(
    router.abi,
    router.bytecode,
    [factoryAddress, weth9Address],
  );
  await saveContract({
    name: `UniswapV2Router02${registrySuffix}`,
    address: routerAddress,
    chain: 'evm',
    chainId,
    deployer,
    deployedAt: new Date().toISOString(),
    abi: router.abi,
  }).catch(() => {
    // non-fatal
  });

  const manifest: V2Manifest = {
    deployedAt: new Date().toISOString(),
    chainId,
    rpcUrl,
    deployer,
    contracts: {
      factory: factoryAddress,
      weth9: weth9Address,
      router02: routerAddress,
    },
    initCodeHash,
  };

  await postManifest(manifest);
  return manifest;
}

export async function verifyDeploymentCore(params: {
  manifest: V2Manifest;
  loadArtifact: (name: string) => ContractArtifact;
}): Promise<{ ok: boolean; pairCount: number; error?: string }> {
  const { manifest, loadArtifact } = params;
  try {
    const client = new EspaceClient({ rpcUrl: manifest.rpcUrl, chainId: manifest.chainId });
    const factory = loadArtifact('UniswapV2Factory');
    const count = await client.publicClient.readContract({
      address: manifest.contracts.factory as `0x${string}`,
      abi: factory.abi,
      functionName: 'allPairsLength',
      args: [],
    }) as bigint;
    return { ok: true, pairCount: Number(count) };
  } catch (err) {
    return { ok: false, pairCount: 0, error: String(err) };
  }
}
