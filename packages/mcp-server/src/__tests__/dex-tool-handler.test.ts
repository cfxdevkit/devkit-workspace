/**
 * dex-tool-handler.test.ts
 *
 * Integration tests for the dex tool handler dispatcher.
 * Tests dispatch routing, unknown tool handling, and the no-manifest early
 * return path for dex_status — without a live devkit backend.
 */
import { describe, expect, it, vi } from 'vitest';
import { createDexToolHandler } from '../features/dex/dex-tool-handler.js';
import type { V2Manifest } from '../features/dex/dex-types.js';
import type { ContractArtifact } from '@cfxdevkit/dex-contracts';
import type { TrackedContract } from '../contracts.js';

// ── Minimal stub manifest ────────────────────────────────────────────────────

const STUB_MANIFEST: V2Manifest = {
  deployedAt: '2024-01-01T00:00:00Z',
  chainId: 2030,
  rpcUrl: 'http://localhost:8545',
  deployer: '0xdeployer',
  contracts: {
    factory: '0xfactory',
    weth9: '0xweth',
    router02: '0xrouter',
  },
  initCodeHash: '0xhash',
};

// ── Mock dep factory ─────────────────────────────────────────────────────────

function makeDeps(overrides: {
  readManifest?: () => Promise<V2Manifest | null>;
} = {}) {
  const noop = async () => {};
  const abis = () => [] as unknown[];
  const artifact: ContractArtifact = {
    contractName: 'MockArtifact',
    abi: [],
    bytecode: '0x',
  };
  const trackedContract: TrackedContract = {
    id: 'mock-id',
    name: 'MockContract',
    address: '0xmock',
    chain: 'evm',
    deployer: '0xdeployer',
    chainId: 2030,
    txHash: '0xtx',
    deployedAt: '2024-01-01T00:00:00Z',
    abi: [],
    metadata: {},
  };

  return {
    mainnetChainId: 1030,
    registrySuffix: '_devkit',
    devkitNameSuffix: ' [devkit]',
    tokenPairGasBufferWei: 0n,
    stableDeployGasBufferWei: 0n,
    stablePairGasBufferWei: 0n,
    stableCrossPairGasBufferWei: 0n,
    readManifest: overrides.readManifest ?? vi.fn(async () => STUB_MANIFEST),
    verifyDeployment: vi.fn(async () => ({ ok: true, pairCount: 3 })),
    deployV2Stack: vi.fn(async () => STUB_MANIFEST),
    readTrackedDexContracts: vi.fn(async () => []),
    fetchWcfxPrice: vi.fn(async () => 0.15),
    getAccount: vi.fn(() => ({ evmAddress: '0xaccount' })),
    resolvePrivateKey: vi.fn(() => '0xprivkey'),
    readTranslationTable: vi.fn(async () => null),
    loadArtifact: vi.fn(() => artifact),
    saveContract: vi.fn(async () => trackedContract),
    findTrackedContractByRealAddress: vi.fn(() => null),
    findTrackedContractByName: vi.fn(() => null),
    ensureFunding: vi.fn(noop),
    postManifest: vi.fn(noop),
    postTranslationTable: vi.fn(noop),
    abis: {
      erc20Abi: abis,
      pairAbi: abis,
      routerAbi: abis,
      factoryAbi: abis,
      wethAbi: abis,
      mirrorAbi: abis,
    },
    simulationRuntime: {
      getOrCreateEngine: vi.fn(async () => ({ engine: {} as never, feedCache: {} as never })),
      getActiveEngine: vi.fn(() => null),
      getActiveStopFn: vi.fn(() => null),
      setActiveStopFn: vi.fn(),
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('createDexToolHandler — dispatch', () => {
  it('returns isError for unknown tool names', async () => {
    const handler = createDexToolHandler(makeDeps());
    const result = await handler('__not_a_real_tool__', {}, 'http://rpc', 2030);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('Unknown dex tool');
  });

  it('dex_status — calls readManifest', async () => {
    const deps = makeDeps();
    const handler = createDexToolHandler(deps);
    await handler('dex_status', {}, 'http://rpc', 2030);
    expect(deps.readManifest).toHaveBeenCalled();
  });

  it('dex_status — returns not-deployed text when manifest is null', async () => {
    const deps = makeDeps({ readManifest: vi.fn(async () => null) });
    const handler = createDexToolHandler(deps);
    const result = await handler('dex_status', {}, 'http://rpc', 2030);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('not deployed');
    expect(result.text).toContain('dex_deploy');
  });

  it('dex_status — returns deployed summary when manifest exists', async () => {
    const deps = makeDeps();
    const handler = createDexToolHandler(deps);
    const result = await handler('dex_status', {}, 'http://rpc', 2030);
    expect(result.isError).toBeUndefined();
    expect(result.text).toContain('deployed');
    expect(result.text).toContain('0xfactory');
  });

  it('dex_list_pairs — returns not-deployed error when manifest is null', async () => {
    const deps = makeDeps({ readManifest: vi.fn(async () => null) });
    const handler = createDexToolHandler(deps);
    const result = await handler('dex_list_pairs', {}, 'http://rpc', 2030);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('dex_deploy');
    expect(deps.readManifest).toHaveBeenCalled();
  });

  it('dex_pool_info — returns not-deployed error when manifest is null', async () => {
    const deps = makeDeps({ readManifest: vi.fn(async () => null) });
    const handler = createDexToolHandler(deps);
    const result = await handler('dex_pool_info', { poolAddress: '0xpool' }, 'http://rpc', 2030);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('dex_deploy');
  });

  it('dex_simulation_step — calls getOrCreateEngine, returns isError on engine stub', async () => {
    const deps = makeDeps();
    const handler = createDexToolHandler(deps);
    // Mock engine has no .step() method — handleSimulationStep catches the TypeError
    const result = await handler('dex_simulation_step', { ticks: 1 }, 'http://rpc', 2030);
    expect(deps.simulationRuntime.getOrCreateEngine).toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
