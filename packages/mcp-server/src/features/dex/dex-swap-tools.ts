import {
  EspaceWalletClient,
  EspaceClient,
} from '@cfxdevkit/core';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { V2Manifest } from './dex-types.js';

type ToolResult = { text: string; isError?: boolean };

type SwapDeps = {
  getAccount: (index: number) => { evmAddress: string };
  resolvePrivateKey: (index: number, chain: 'espace') => string;
  readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
  loadArtifact: (name: string) => ContractArtifact;
  erc20Abi: () => unknown[];
};

export async function handleSwap(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: SwapDeps;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) {
    return { text: '❌ v2-manifest.json not found. Run dex_deploy first.', isError: true };
  }

  const rawIn = args.tokenIn as string;
  const rawOut = args.tokenOut as string;
  const amountInStr = args.amountIn as string;
  const slippage = (args.slippage as number | undefined) ?? 1.0;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;

  const isNativeIn = rawIn.toUpperCase() === 'WCFX' || rawIn.toUpperCase() === 'CFX';
  const isNativeOut = rawOut.toUpperCase() === 'WCFX' || rawOut.toUpperCase() === 'CFX';
  const tokenIn = isNativeIn ? manifest.contracts.weth9 : rawIn;
  const tokenOut = isNativeOut ? manifest.contracts.weth9 : rawOut;

  const account = deps.getAccount(accountIndex);
  const privateKey = deps.resolvePrivateKey(accountIndex, 'espace');
  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const deployer = account.evmAddress;
  const client = new EspaceClient({ rpcUrl, chainId });

  const decIn = isNativeIn ? 18 : Number(
    await client.publicClient.readContract({ address: tokenIn as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }),
  );
  const decOut = isNativeOut ? 18 : Number(
    await client.publicClient.readContract({ address: tokenOut as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }),
  );

  const amountInWei = BigInt(Math.floor(parseFloat(amountInStr) * 10 ** decIn));
  const path = [tokenIn, tokenOut];
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  const routerArtifact = deps.loadArtifact('UniswapV2Router02');

  const amounts = await client.publicClient.readContract({
    address: manifest.contracts.router02 as `0x${string}`,
    abi: routerArtifact.abi,
    functionName: 'getAmountsOut',
    args: [amountInWei, path],
  }) as bigint[];

  const expectedOut = amounts[amounts.length - 1];
  const minOut = expectedOut * BigInt(Math.floor((100 - slippage) * 100)) / 10000n;

  let txReceipt: unknown;

  if (isNativeIn) {
    txReceipt = await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'swapExactETHForTokens',
      [minOut, path, deployer, deadline],
      amountInWei,
    );
  } else if (isNativeOut) {
    await wallet.writeAndWait(
      tokenIn as `0x${string}`,
      deps.erc20Abi(),
      'approve',
      [manifest.contracts.router02, amountInWei],
    );
    txReceipt = await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'swapExactTokensForETH',
      [amountInWei, minOut, path, deployer, deadline],
    );
  } else {
    await wallet.writeAndWait(
      tokenIn as `0x${string}`,
      deps.erc20Abi(),
      'approve',
      [manifest.contracts.router02, amountInWei],
    );
    txReceipt = await wallet.writeAndWait(
      manifest.contracts.router02 as `0x${string}`,
      routerArtifact.abi,
      'swapExactTokensForTokens',
      [amountInWei, minOut, path, deployer, deadline],
    );
  }

  const txHash = (txReceipt as { transactionHash?: string })?.transactionHash ?? 'confirmed';
  const outHuman = (Number(expectedOut) / 10 ** decOut).toFixed(6);

  return {
    text: [
      '✅ Swap executed',
      `   In:  ${amountInStr} ${isNativeIn ? 'CFX' : rawIn}`,
      `   Out: ~${outHuman} ${isNativeOut ? 'CFX' : rawOut}`,
      `   Slippage: ${slippage}%`,
      `   Tx:  ${txHash}`,
    ].join('\n'),
  };
}
