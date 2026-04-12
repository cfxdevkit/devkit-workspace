import type { SimulationEngine, FeedCache } from '@cfxdevkit/shared';

type EngineFactory = (
  accountIndex: number,
  rpcUrl: string,
  chainId: number,
  configOverrides?: { minDeviationBps?: number; tickIntervalMs?: number },
) => Promise<{ engine: SimulationEngine; feedCache: FeedCache }>;

export function createSimulationRuntime(createEngine: EngineFactory) {
  let activeEngine: SimulationEngine | null = null;
  let activeFeedCache: FeedCache | null = null;
  let activeStopFn: (() => void) | null = null;

  async function getOrCreateEngine(
    accountIndex: number,
    rpcUrl: string,
    chainId: number,
    configOverrides?: { minDeviationBps?: number; tickIntervalMs?: number },
  ): Promise<{ engine: SimulationEngine; feedCache: FeedCache }> {
    if (activeEngine && activeFeedCache) {
      return { engine: activeEngine, feedCache: activeFeedCache };
    }

    const { engine, feedCache } = await createEngine(accountIndex, rpcUrl, chainId, configOverrides);
    activeEngine = engine;
    activeFeedCache = feedCache;
    return { engine, feedCache };
  }

  function getActiveEngine(): SimulationEngine | null {
    return activeEngine;
  }

  function getActiveStopFn(): (() => void) | null {
    return activeStopFn;
  }

  function setActiveStopFn(fn: (() => void) | null): void {
    activeStopFn = fn;
  }

  function destroy(): void {
    if (activeStopFn) {
      activeStopFn();
      activeStopFn = null;
    }
    if (activeEngine) {
      activeEngine.destroy();
      activeEngine = null;
    }
    activeFeedCache = null;
  }

  return {
    getOrCreateEngine,
    getActiveEngine,
    getActiveStopFn,
    setActiveStopFn,
    destroy,
  };
}
