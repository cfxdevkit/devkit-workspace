import type {
  SimulationEngine,
  FeedCache,
} from '@cfxdevkit/shared';
import { formatTickResult } from './dex-simulation-format.js';

type ToolResult = { text: string; isError?: boolean };

type SimulationConfigOverrides = {
  minDeviationBps?: number;
  tickIntervalMs?: number;
};

type GetOrCreateEngine = (
  accountIndex: number,
  rpcUrl: string,
  chainId: number,
  configOverrides?: SimulationConfigOverrides,
) => Promise<{ engine: SimulationEngine; feedCache: FeedCache }>;

export type SimulationStateAccess = {
  getActiveEngine: () => SimulationEngine | null;
  getActiveStopFn: () => (() => void) | null;
  setActiveStopFn: (fn: (() => void) | null) => void;
};

export async function handleSimulationStep(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  getOrCreateEngine: GetOrCreateEngine;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, getOrCreateEngine } = params;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;
  const minDeviationBps = (args.minDeviationBps as number | undefined);

  try {
    const { engine, feedCache } = await getOrCreateEngine(accountIndex, rpcUrl, chainId, {
      minDeviationBps,
    });

    const result = await engine.step(feedCache);
    const progress = engine.getProgress();
    const stats = engine.getTickStats();

    return {
      text: [
        formatTickResult(result),
        '',
        `Progress: ${progress.processed}/${progress.total} candles (${progress.percent}%)`,
        `Stats: ${stats.ticks} ticks, ${stats.rebalances} rebalances, ${stats.swapsSent} swaps, ${stats.errors} errors`,
      ].join('\n'),
    };
  } catch (err) {
    return { text: `❌  ${String(err)}`, isError: true };
  }
}

export async function handleSimulationStart(params: {
  args: Record<string, unknown>;
  rpcUrl: string;
  chainId: number;
  getOrCreateEngine: GetOrCreateEngine;
  state: SimulationStateAccess;
}): Promise<ToolResult> {
  const { args, rpcUrl, chainId, getOrCreateEngine, state } = params;
  const accountIndex = (args.accountIndex as number | undefined) ?? 0;
  const tickIntervalMs = (args.tickIntervalMs as number | undefined) ?? 2000;
  const minDeviationBps = (args.minDeviationBps as number | undefined);

  if (state.getActiveStopFn()) {
    return { text: '⚠️  Simulation already running. Call dex_simulation_stop first.' };
  }

  try {
    const { engine, feedCache } = await getOrCreateEngine(accountIndex, rpcUrl, chainId, {
      minDeviationBps,
      tickIntervalMs,
    });

    state.setActiveStopFn(engine.start(feedCache));
    const progress = engine.getProgress();

    return {
      text: [
        '✅  Simulation started (continuous mode)',
        `    Tick interval: ${tickIntervalMs}ms`,
        `    Tokens: ${engine.getTokenCount()}`,
        `    Progress: ${progress.processed}/${progress.total} candles (${progress.percent}%)`,
        '',
        'Use dex_simulation_step to check progress, dex_simulation_stop to halt.',
      ].join('\n'),
    };
  } catch (err) {
    return { text: `❌  ${String(err)}`, isError: true };
  }
}

export async function handleSimulationStop(params: {
  state: SimulationStateAccess;
}): Promise<ToolResult> {
  const { state } = params;

  const stopFn = state.getActiveStopFn();
  if (stopFn) {
    stopFn();
    state.setActiveStopFn(null);
  }

  const engine = state.getActiveEngine();
  if (!engine) {
    return { text: 'No simulation engine active.' };
  }

  const stats = engine.getTickStats();
  const progress = engine.getProgress();
  const prices = engine.getCurrentPrices();

  const priceLines = Object.entries(prices).map(
    ([sym, p]) => `  ${sym.padEnd(10)} ${p.toPrecision(4)} WCFX`,
  );

  return {
    text: [
      '⏹  Simulation stopped.',
      '',
      `Progress: ${progress.processed}/${progress.total} candles (${progress.percent}%)`,
      `Stats: ${stats.ticks} ticks, ${stats.rebalances} rebalances, ${stats.swapsSent} swaps, ${stats.errors} errors`,
      '',
      'Current prices:',
      ...priceLines,
      '',
      'Use dex_simulation_start to resume, dex_simulation_reset to revert.',
    ].join('\n'),
  };
}

export async function handleSimulationReset(params: {
  state: SimulationStateAccess;
}): Promise<ToolResult> {
  const { state } = params;

  const stopFn = state.getActiveStopFn();
  if (stopFn) {
    stopFn();
    state.setActiveStopFn(null);
  }

  const engine = state.getActiveEngine();
  if (!engine) {
    return { text: 'No simulation engine active. Nothing to reset.' };
  }

  try {
    await engine.reset();
    return {
      text: [
        '🔄  Simulation reset to post-seed state.',
        'All reserves reverted. Candle indices reset to 0.',
        '',
        'Use dex_simulation_step or dex_simulation_start to begin again.',
      ].join('\n'),
    };
  } catch (err) {
    return { text: `❌  Reset failed: ${String(err)}`, isError: true };
  }
}
