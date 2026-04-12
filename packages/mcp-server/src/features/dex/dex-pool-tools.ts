import { EspaceClient } from '@cfxdevkit/core';
import type { V2Manifest } from './dex-types.js';

type ToolResult = { text: string; isError?: boolean };

type PoolDeps = {
  readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
  erc20Abi: () => unknown[];
  pairAbi: () => unknown[];
  factoryAbi: () => unknown[];
};

export async function handlePoolInfo(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: PoolDeps;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) {
    return { text: '❌ v2-manifest.json not found. Run dex_deploy first.', isError: true };
  }

  const client = new EspaceClient({ rpcUrl, chainId });
  let pairAddr = args.pairAddress as string | undefined;

  if (!pairAddr) {
    const tA = args.tokenA as string;
    const tB = (args.tokenB as string | undefined) ?? manifest.contracts.weth9;
    if (!tA) {
      return { text: '❌ Provide pairAddress or tokenA (+tokenB).', isError: true };
    }
    pairAddr = await client.publicClient.readContract({
      address: manifest.contracts.factory as `0x${string}`,
      abi: deps.factoryAbi(),
      functionName: 'getPair',
      args: [tA, tB],
    }) as string;
    if (!pairAddr || pairAddr === '0x0000000000000000000000000000000000000000') {
      return { text: '❌ Pair not found.', isError: true };
    }
  }

  const [t0Addr, t1Addr, reserves, totalSupply] = await Promise.all([
    client.publicClient.readContract({ address: pairAddr as `0x${string}`, abi: deps.pairAbi(), functionName: 'token0' }) as Promise<string>,
    client.publicClient.readContract({ address: pairAddr as `0x${string}`, abi: deps.pairAbi(), functionName: 'token1' }) as Promise<string>,
    client.publicClient.readContract({ address: pairAddr as `0x${string}`, abi: deps.pairAbi(), functionName: 'getReserves', args: [] }) as Promise<[bigint, bigint, number]>,
    client.publicClient.readContract({ address: pairAddr as `0x${string}`, abi: deps.erc20Abi(), functionName: 'totalSupply' }) as Promise<bigint>,
  ]);

  const [sym0, dec0, sym1, dec1] = await Promise.all([
    client.publicClient.readContract({ address: t0Addr as `0x${string}`, abi: deps.erc20Abi(), functionName: 'symbol' }) as Promise<string>,
    client.publicClient.readContract({ address: t0Addr as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
    client.publicClient.readContract({ address: t1Addr as `0x${string}`, abi: deps.erc20Abi(), functionName: 'symbol' }) as Promise<string>,
    client.publicClient.readContract({ address: t1Addr as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
  ]);

  const r0 = Number(reserves[0]) / 10 ** Number(dec0);
  const r1 = Number(reserves[1]) / 10 ** Number(dec1);
  const price01 = r1 > 0 ? (r0 / r1).toPrecision(6) : 'N/A';
  const price10 = r0 > 0 ? (r1 / r0).toPrecision(6) : 'N/A';

  return {
    text: [
      `Pool: ${sym0}/${sym1}`,
      `  Pair:       ${pairAddr}`,
      `  Token0:     ${t0Addr} (${sym0}, ${dec0} dec)`,
      `  Token1:     ${t1Addr} (${sym1}, ${dec1} dec)`,
      `  Reserve0:   ${r0.toFixed(4)} ${sym0}`,
      `  Reserve1:   ${r1.toFixed(4)} ${sym1}`,
      `  Price:      1 ${sym1} = ${price01} ${sym0}`,
      `              1 ${sym0} = ${price10} ${sym1}`,
      `  LP Supply:  ${(Number(totalSupply) / 1e18).toFixed(4)}`,
    ].join('\n'),
  };
}

export async function handleListPairs(params: {
  rpcUrl: string;
  chainId: number;
  deps: PoolDeps;
}): Promise<ToolResult> {
  const { rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest(rpcUrl, chainId);
  if (!manifest) {
    return { text: '❌ v2-manifest.json not found. Run dex_deploy first.', isError: true };
  }

  const client = new EspaceClient({ rpcUrl, chainId });
  const pairCount = Number(await client.publicClient.readContract({
    address: manifest.contracts.factory as `0x${string}`,
    abi: deps.factoryAbi(),
    functionName: 'allPairsLength',
  }));

  if (pairCount === 0) {
    return { text: 'No pairs found. Use dex_seed_from_gecko or dex_create_pair.' };
  }

  const lines: string[] = [`${pairCount} pairs on factory ${manifest.contracts.factory}`, ''];
  const header = `${'Pair'.padEnd(20) + 'Reserve0'.padEnd(18) + 'Reserve1'.padEnd(18)}Address`;
  lines.push(header, '─'.repeat(header.length));

  for (let i = 0; i < pairCount; i++) {
    try {
      const pAddr = await client.publicClient.readContract({
        address: manifest.contracts.factory as `0x${string}`,
        abi: deps.factoryAbi(),
        functionName: 'allPairs',
        args: [BigInt(i)],
      }) as string;

      const [t0, t1, res] = await Promise.all([
        client.publicClient.readContract({ address: pAddr as `0x${string}`, abi: deps.pairAbi(), functionName: 'token0' }) as Promise<string>,
        client.publicClient.readContract({ address: pAddr as `0x${string}`, abi: deps.pairAbi(), functionName: 'token1' }) as Promise<string>,
        client.publicClient.readContract({ address: pAddr as `0x${string}`, abi: deps.pairAbi(), functionName: 'getReserves', args: [] }) as Promise<[bigint, bigint, number]>,
      ]);

      const [s0, d0, s1, d1] = await Promise.all([
        client.publicClient.readContract({ address: t0 as `0x${string}`, abi: deps.erc20Abi(), functionName: 'symbol' }) as Promise<string>,
        client.publicClient.readContract({ address: t0 as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
        client.publicClient.readContract({ address: t1 as `0x${string}`, abi: deps.erc20Abi(), functionName: 'symbol' }) as Promise<string>,
        client.publicClient.readContract({ address: t1 as `0x${string}`, abi: deps.erc20Abi(), functionName: 'decimals' }) as Promise<number>,
      ]);

      const r0 = (Number(res[0]) / 10 ** Number(d0)).toFixed(2);
      const r1 = (Number(res[1]) / 10 ** Number(d1)).toFixed(2);
      lines.push(`${(`${s0}/${s1}`).padEnd(20)}${(`${r0} ${s0}`).padEnd(18)}${(`${r1} ${s1}`).padEnd(18)}${pAddr}`);
    } catch (err) {
      lines.push(`  Pair ${i}: error — ${String(err).split('\n')[0]}`);
    }
  }

  return { text: lines.join('\n') };
}
