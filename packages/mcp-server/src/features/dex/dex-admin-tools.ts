import type { V2Manifest } from './dex-types.js';
import type { SimulationEngine } from '@cfxdevkit/shared';

type ToolResult = { text: string; isError?: boolean };

type VerifyResult = { ok: boolean; pairCount: number; error?: string };

type AdminDeps = {
  readManifest: (rpcUrl?: string, chainId?: number) => Promise<V2Manifest | null>;
  verifyDeployment: (manifest: V2Manifest) => Promise<VerifyResult>;
  deployV2Stack: (accountIndex: number, rpcUrl: string, chainId: number) => Promise<V2Manifest>;
  getActiveEngine: () => SimulationEngine | null;
};

export async function handleDexStatus(params: {
  rpcUrl: string;
  chainId: number;
  deps: AdminDeps;
}): Promise<ToolResult> {
  const { rpcUrl, chainId, deps } = params;
  const manifest = await deps.readManifest();
  if (!manifest) {
    return {
      text: [
        'V2 DEX: not deployed',
        '',
        'v2-manifest.json not found. Run dex_deploy to deploy the V2 stack.',
        '',
        'Prerequisites:',
        '  1. conflux_status → check node is running',
        '  2. dex_deploy     → deploy Factory + WETH9 + Router02',
      ].join('\n'),
    };
  }

  const verify = await deps.verifyDeployment({ ...manifest, rpcUrl, chainId: chainId ?? manifest.chainId });

  const stableLines: string[] = [];
  if (manifest.stables && Object.keys(manifest.stables).length > 0) {
    stableLines.push('', 'Stablecoins:');
    for (const [sym, entry] of Object.entries(manifest.stables)) {
      stableLines.push(`  ${sym.padEnd(6)} ${entry.address}  (${entry.decimals} dec)`);
    }
  }

  const simLines: string[] = [];
  const activeEngine = deps.getActiveEngine();
  if (activeEngine) {
    const state = activeEngine.getState();
    const stats = activeEngine.getTickStats();
    const progress = activeEngine.getProgress();
    simLines.push(
      '',
      `Simulation: ${state}`,
      `  Progress: ${progress.processed}/${progress.total} candles (${progress.percent}%)`,
      `  Ticks: ${stats.ticks}  Rebalances: ${stats.rebalances}  Swaps: ${stats.swapsSent}  Errors: ${stats.errors}`,
    );
  } else {
    simLines.push('', 'Simulation: not initialized');
  }

  return {
    text: [
      'V2 DEX: deployed ✓',
      `Deployed At:  ${manifest.deployedAt}`,
      `Deployer:     ${manifest.deployer}`,
      `Chain ID:     ${manifest.chainId}`,
      '',
      'Contracts:',
      `  Factory:    ${manifest.contracts.factory}`,
      `  WETH9:      ${manifest.contracts.weth9}`,
      `  Router02:   ${manifest.contracts.router02}`,
      '',
      `Init Code Hash: ${manifest.initCodeHash}`,
      '',
      `On-chain pairs: ${verify.ok ? verify.pairCount : `RPC error — ${verify.error}`}`,
      verify.ok && verify.pairCount === 0
        ? '\nNo pairs created yet. Use dex_seed_from_gecko or add liquidity manually.'
        : '',
      ...stableLines,
      ...simLines,
    ].filter((l) => l !== undefined).join('\n'),
  };
}

export async function handleDexDeploy(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  deps: AdminDeps;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, deps } = params;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;

  const existing = await deps.readManifest(rpcUrl, chainId);
  if (existing) {
    return {
      text: [
        '⚠️  V2 DEX already deployed — skipping.',
        '',
        `Factory:  ${existing.contracts.factory}`,
        `WETH9:    ${existing.contracts.weth9}`,
        `Router02: ${existing.contracts.router02}`,
        '',
        'To redeploy, delete v2-manifest.json first, then run dex_deploy again.',
        '(Note: redeploy on a fresh node — old addresses will be invalid after a wipe.)',
      ].join('\n'),
    };
  }

  const manifest = await deps.deployV2Stack(accountIndex, rpcUrl, chainId);
  const verify = await deps.verifyDeployment(manifest);

  return {
    text: [
      '✅  Uniswap V2 stack deployed to eSpace',
      '',
      `Factory:        ${manifest.contracts.factory}`,
      `WETH9:          ${manifest.contracts.weth9}`,
      `Router02:       ${manifest.contracts.router02}`,
      `Deployer:       ${manifest.deployer}`,
      `Chain ID:       ${manifest.chainId}`,
      `Init Code Hash: ${manifest.initCodeHash}`,
      '',
      `Factory allPairsLength() = ${verify.ok ? verify.pairCount : `RPC error — ${verify.error}`}`,
      '',
      'Addresses saved to DEX service.',
      'All contracts tracked in devkit contract registry.',
      '',
      'Next steps:',
      '  dex_status           → confirm deployment',
      '  dex_seed_from_gecko  → seed from selected GeckoTerminal source pools',
      `  cfxdevkit_contract_call(nameOrAddress="UniswapV2Factory", functionName="allPairsLength")  → ${verify.ok ? verify.pairCount : '?'} pairs`,
    ].join('\n'),
  };
}
