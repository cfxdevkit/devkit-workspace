import {
  EspaceWalletClient,
  EspaceClient,
} from '@cfxdevkit/core';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { V2Manifest } from './dex-types.js';

type ToolResult = { text: string; isError?: boolean };

type LiquidityDeps = {
  getAccount: (index: number) => { evmAddress: string };
  resolvePrivateKey: (index: number, chain: 'espace') => string;
  readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
  loadArtifact: (name: string) => ContractArtifact;
  erc20Abi: () => unknown[];
  factoryAbi: () => unknown[];
  pairAbi: () => unknown[];
};

function resolvePairTokenB(rawTokenB: string | undefined, wethAddress: string): { tokenB: string; isWcfxPair: boolean } {
  const resolved = rawTokenB ?? 'WCFX';
  const isWcfxPair = resolved.toUpperCase() === 'WCFX' || resolved.toUpperCase() === 'CFX';
  return { tokenB: isWcfxPair ? wethAddress : resolved, isWcfxPair };
}

export async function handleCreatePair(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: LiquidityDeps;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) {
    return { text: '❌ v2-manifest.json not found. Run dex_deploy first.', isError: true };
  }

  const tokenA = args.tokenA as string;
  const amountAStr = args.amountA as string;
  const amountBStr = args.amountB as string;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;

  const { tokenB, isWcfxPair } = resolvePairTokenB(args.tokenB as string | undefined, manifest.contracts.weth9);

  const account = deps.getAccount(accountIndex);
  const privateKey = deps.resolvePrivateKey(accountIndex, 'espace');
  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const deployer = account.evmAddress;
  const client = new EspaceClient({ rpcUrl, chainId });

  const [decA, decB, symA, symB] = await Promise.all([
    client.publicClient.readContract({ address: tokenA as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
    client.publicClient.readContract({ address: tokenB as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
    client.publicClient.readContract({ address: tokenA as `0x${string}`, abi: deps.erc20Abi(), functionName: 'symbol' }) as Promise<string>,
    client.publicClient.readContract({ address: tokenB as `0x${string}`, abi: deps.erc20Abi(), functionName: 'symbol' }) as Promise<string>,
  ]);

  const amountAWei = BigInt(Math.floor(parseFloat(amountAStr) * 10 ** Number(decA)));
  const amountBWei = BigInt(Math.floor(parseFloat(amountBStr) * 10 ** Number(decB)));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const routerArtifact = deps.loadArtifact('UniswapV2Router02');

  await wallet.writeAndWait(
    tokenA as `0x${string}`,
    deps.erc20Abi(),
    'approve',
    [manifest.contracts.router02, amountAWei],
  );

  if (isWcfxPair) {
    await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'addLiquidityETH',
      [tokenA, amountAWei, 0n, 0n, deployer, deadline],
      amountBWei,
    );
  } else {
    await wallet.writeAndWait(
      tokenB as `0x${string}`,
      deps.erc20Abi(),
      'approve',
      [manifest.contracts.router02, amountBWei],
    );
    await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'addLiquidity',
      [tokenA, tokenB, amountAWei, amountBWei, 0n, 0n, deployer, deadline],
    );
  }

  const pairAddress = await client.publicClient.readContract({
    address: manifest.contracts.factory as `0x${string}`,
    abi: deps.factoryAbi(),
    functionName: 'getPair',
    args: [tokenA, tokenB],
  }) as string;

  const reserves = await client.publicClient.readContract({
    address: pairAddress as `0x${string}`,
    abi: deps.pairAbi(),
    functionName: 'getReserves',
    args: [],
  }) as [bigint, bigint, number];

  return {
    text: [
      `✅ Pair created: ${symA}/${isWcfxPair ? 'WCFX' : symB}`,
      `   Pair:     ${pairAddress}`,
      `   TokenA:   ${tokenA} (${symA})`,
      `   TokenB:   ${tokenB} (${isWcfxPair ? 'WCFX' : symB})`,
      `   Reserve0: ${reserves[0]}`,
      `   Reserve1: ${reserves[1]}`,
      `   AmountA:  ${amountAStr} ${symA}`,
      `   AmountB:  ${amountBStr} ${isWcfxPair ? 'CFX' : symB}`,
    ].join('\n'),
  };
}

export async function handleAddLiquidity(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: LiquidityDeps;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) {
    return { text: '❌ v2-manifest.json not found. Run dex_deploy first.', isError: true };
  }

  const tokenA = args.tokenA as string;
  const amountAStr = args.amountA as string;
  const amountBStr = args.amountB as string;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;

  const { tokenB, isWcfxPair } = resolvePairTokenB(args.tokenB as string | undefined, manifest.contracts.weth9);

  const account = deps.getAccount(accountIndex);
  const privateKey = deps.resolvePrivateKey(accountIndex, 'espace');
  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const deployer = account.evmAddress;
  const client = new EspaceClient({ rpcUrl, chainId });

  const [decA, decB] = await Promise.all([
    client.publicClient.readContract({ address: tokenA as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
    client.publicClient.readContract({ address: tokenB as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
  ]);

  const amountAWei = BigInt(Math.floor(parseFloat(amountAStr) * 10 ** Number(decA)));
  const amountBWei = BigInt(Math.floor(parseFloat(amountBStr) * 10 ** Number(decB)));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const routerArtifact = deps.loadArtifact('UniswapV2Router02');

  await wallet.writeAndWait(
    tokenA as `0x${string}`,
    deps.erc20Abi(),
    'approve',
    [manifest.contracts.router02, amountAWei],
  );

  if (isWcfxPair) {
    await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'addLiquidityETH',
      [tokenA, amountAWei, 0n, 0n, deployer, deadline],
      amountBWei,
    );
  } else {
    await wallet.writeAndWait(
      tokenB as `0x${string}`,
      deps.erc20Abi(),
      'approve',
      [manifest.contracts.router02, amountBWei],
    );
    await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'addLiquidity',
      [tokenA, tokenB, amountAWei, amountBWei, 0n, 0n, deployer, deadline],
    );
  }

  return {
    text: `✅ Liquidity added: ${amountAStr} tokenA + ${amountBStr} ${isWcfxPair ? 'CFX' : 'tokenB'}`,
  };
}

export async function handleRemoveLiquidity(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: LiquidityDeps;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) {
    return { text: '❌ v2-manifest.json not found. Run dex_deploy first.', isError: true };
  }

  const tokenA = args.tokenA as string;
  const lpAmountStr = args.lpAmount as string;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;

  const { tokenB, isWcfxPair } = resolvePairTokenB(args.tokenB as string | undefined, manifest.contracts.weth9);

  const account = deps.getAccount(accountIndex);
  const privateKey = deps.resolvePrivateKey(accountIndex, 'espace');
  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const deployer = account.evmAddress;
  const client = new EspaceClient({ rpcUrl, chainId });

  const routerArtifact = deps.loadArtifact('UniswapV2Router02');

  const pairAddress = await client.publicClient.readContract({
    address: manifest.contracts.factory as `0x${string}`,
    abi: deps.factoryAbi(),
    functionName: 'getPair',
    args: [tokenA, tokenB],
  }) as string;

  if (!pairAddress || pairAddress === '0x0000000000000000000000000000000000000000') {
    return { text: '❌ Pair does not exist.', isError: true };
  }

  const lpAmountWei = BigInt(Math.floor(parseFloat(lpAmountStr) * 1e18));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  await wallet.writeAndWait(
    pairAddress as `0x${string}`,
    deps.erc20Abi(),
    'approve',
    [manifest.contracts.router02, lpAmountWei],
  );

  if (isWcfxPair) {
    await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'removeLiquidityETH',
      [tokenA, lpAmountWei, 0n, 0n, deployer, deadline],
    );
  } else {
    await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'removeLiquidity',
      [tokenA, tokenB, lpAmountWei, 0n, 0n, deployer, deadline],
    );
  }

  return {
    text: `✅ Removed ${lpAmountStr} LP tokens from ${tokenA}/${isWcfxPair ? 'WCFX' : tokenB}`,
  };
}
