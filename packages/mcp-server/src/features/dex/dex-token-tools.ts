import { EspaceWalletClient } from '@cfxdevkit/core';
import type { TrackedContract } from '../../contracts.js';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';

type ToolResult = { text: string; isError?: boolean };

type SaveContractInput = {
  name: string;
  address: string;
  chain: 'evm';
  chainId: number;
  deployer: string;
  deployedAt: string;
  abi: unknown[];
  metadata?: {
    symbol: string;
    decimals: number;
  };
};

export async function handleCreateToken(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  registrySuffix: string;
  devkitNameSuffix: string;
  getAccount: (index: number) => { evmAddress: string };
  resolvePrivateKey: (index: number, chain: 'espace') => string;
  readTrackedDexContracts: (chainId: number) => Promise<TrackedContract[]>;
  findTrackedContractByName: (contracts: TrackedContract[], name: string) => TrackedContract | null;
  saveContract: (contract: SaveContractInput) => Promise<unknown>;
  loadArtifact: (name: string) => ContractArtifact;
  mirrorAbi: () => unknown[];
}): Promise<ToolResult> {
  const {
    args,
    rpcUrl,
    chainId,
    registrySuffix,
    devkitNameSuffix,
    getAccount,
    resolvePrivateKey,
    readTrackedDexContracts,
    findTrackedContractByName,
    saveContract,
    loadArtifact,
    mirrorAbi,
  } = params;

  const tokenName = args.name as string;
  const tokenSymbol = args.symbol as string;
  const decimals = (args.decimals as number | undefined) ?? 18;
  const supplyStr = (args.initialSupply as string | undefined) ?? '1000000';
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;

  if (!tokenName || !tokenSymbol) {
    return { text: '❌ name and symbol are required.', isError: true };
  }

  const account = getAccount(accountIndex);
  const privateKey = resolvePrivateKey(accountIndex, 'espace');
  const wallet = new EspaceWalletClient({ rpcUrl, chainId, privateKey });
  const deployer = account.evmAddress;

  const existingToken = findTrackedContractByName(
    await readTrackedDexContracts(chainId),
    `${tokenSymbol}${registrySuffix}`,
  );
  if (existingToken) {
    return {
      text: [
        `⚠️  Token ${tokenSymbol} is already tracked — skipping duplicate deployment.`,
        '',
        `Address:  ${existingToken.address}`,
        `Deployed: ${existingToken.deployedAt}`,
        '',
        'If you need a fresh token, use a new symbol or clear the old deployment first.',
      ].join('\n'),
    };
  }

  const mirrorArtifact = loadArtifact('MirrorERC20');
  const displayName = tokenName + devkitNameSuffix;

  const address = await wallet.deployContract(
    mirrorArtifact.abi,
    mirrorArtifact.bytecode,
    [displayName, tokenSymbol, decimals],
  );

  const supplyWei = BigInt(Math.floor(parseFloat(supplyStr) * 10 ** decimals));
  if (supplyWei > 0n) {
    await wallet.writeAndWait(
      address as `0x${string}`,
      mirrorAbi(),
      'mint',
      [deployer, supplyWei],
    );
  }

  await saveContract({
    name: `${tokenSymbol}${registrySuffix}`,
    address,
    chain: 'evm',
    chainId,
    deployer,
    deployedAt: new Date().toISOString(),
    abi: mirrorArtifact.abi,
    metadata: {
      symbol: tokenSymbol,
      decimals,
    },
  });

  return {
    text: [
      `✅ Token deployed: ${displayName} (${tokenSymbol})`,
      '',
      `   Address:  ${address}`,
      `   Decimals: ${decimals}`,
      `   Supply:   ${supplyStr} ${tokenSymbol} (${supplyWei} wei)`,
      `   Deployer: ${deployer}`,
      '',
      'Token tracked in devkit contract registry.',
      'Use dex_create_pair to add a liquidity pool.',
    ].join('\n'),
  };
}
