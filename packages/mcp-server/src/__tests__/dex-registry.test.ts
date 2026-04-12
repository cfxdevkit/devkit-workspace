import { describe, expect, it } from 'vitest';
import {
  buildManifestFromTrackedContracts,
  buildTranslationTableFromTrackedContracts,
  findTrackedContractByName,
  findTrackedContractByRealAddress,
} from '../features/dex/dex-registry.js';
import type { TrackedContract } from '../contracts.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeContract(overrides: Partial<TrackedContract> & { name: string }): TrackedContract {
  return {
    id: overrides.name,
    address: '0xaaaa',
    chain: 'evm',
    deployer: '0xdeployer',
    deployedAt: '2024-01-01T00:00:00Z',
    chainId: 2030,
    ...overrides,
  };
}

const FACTORY = makeContract({ name: 'UniswapV2Factory_devkit', address: '0xfactory', deployedAt: '2024-02-01T00:00:00Z', metadata: { initCodeHash: '0xhash' } });
const WETH9 = makeContract({ name: 'WETH9_devkit', address: '0xweth' });
const ROUTER = makeContract({ name: 'UniswapV2Router02_devkit', address: '0xrouter' });
const MIRROR = makeContract({
  name: 'USDT_devkit',
  address: '0xlocal',
  metadata: { realAddress: '0xREAL', symbol: 'USDT', decimals: 18 },
});
const ALL = [FACTORY, WETH9, ROUTER, MIRROR];

// ── findTrackedContractByName ────────────────────────────────────────────────

describe('findTrackedContractByName', () => {
  it('returns matching contract', () => {
    const result = findTrackedContractByName(ALL, 'WETH9_devkit');
    expect(result?.address).toBe('0xweth');
  });

  it('returns null when not found', () => {
    expect(findTrackedContractByName(ALL, 'Missing')).toBeNull();
  });

  it('returns latest when duplicate names exist', () => {
    const older = makeContract({ name: 'UniswapV2Factory_devkit', address: '0xold', deployedAt: '2023-01-01T00:00:00Z' });
    const newer = makeContract({ name: 'UniswapV2Factory_devkit', address: '0xnew', deployedAt: '2025-01-01T00:00:00Z' });
    expect(findTrackedContractByName([older, newer], 'UniswapV2Factory_devkit')?.address).toBe('0xnew');
  });

  it('returns empty list contract when only one option', () => {
    expect(findTrackedContractByName([FACTORY], 'UniswapV2Factory_devkit')?.address).toBe('0xfactory');
  });
});

// ── findTrackedContractByRealAddress ────────────────────────────────────────

describe('findTrackedContractByRealAddress', () => {
  it('finds mirror contract by real address (case-insensitive)', () => {
    const result = findTrackedContractByRealAddress(ALL, '0xreal');
    expect(result?.address).toBe('0xlocal');
  });

  it('returns null for address without metadata.realAddress', () => {
    expect(findTrackedContractByRealAddress([FACTORY, WETH9], '0xfactory')).toBeNull();
  });

  it('returns null on empty list', () => {
    expect(findTrackedContractByRealAddress([], '0xreal')).toBeNull();
  });
});

// ── buildManifestFromTrackedContracts ────────────────────────────────────────

describe('buildManifestFromTrackedContracts', () => {
  it('builds manifest from complete contract set', () => {
    const manifest = buildManifestFromTrackedContracts(ALL, 'http://localhost:8545', 2030, '_devkit');
    expect(manifest).not.toBeNull();
    expect(manifest?.contracts.factory).toBe('0xfactory');
    expect(manifest?.contracts.weth9).toBe('0xweth');
    expect(manifest?.contracts.router02).toBe('0xrouter');
    expect(manifest?.chainId).toBe(2030);
    expect(manifest?.rpcUrl).toBe('http://localhost:8545');
  });

  it('uses initCodeHash from factory metadata when present', () => {
    const manifest = buildManifestFromTrackedContracts(ALL, 'http://rpc', 2030, '_devkit');
    expect(manifest?.initCodeHash).toBe('0xhash');
  });

  it('returns null when factory is missing', () => {
    expect(buildManifestFromTrackedContracts([WETH9, ROUTER], 'http://rpc', 2030, '_devkit')).toBeNull();
  });

  it('returns null when weth9 is missing', () => {
    expect(buildManifestFromTrackedContracts([FACTORY, ROUTER], 'http://rpc', 2030, '_devkit')).toBeNull();
  });

  it('returns null when router is missing', () => {
    expect(buildManifestFromTrackedContracts([FACTORY, WETH9], 'http://rpc', 2030, '_devkit')).toBeNull();
  });

  it('returns null on empty list', () => {
    expect(buildManifestFromTrackedContracts([], 'http://rpc', 2030, '_devkit')).toBeNull();
  });
});

// ── buildTranslationTableFromTrackedContracts ────────────────────────────────

describe('buildTranslationTableFromTrackedContracts', () => {
  it('builds translation table from mirror contracts', () => {
    const table = buildTranslationTableFromTrackedContracts(ALL, '0xweth', 2030, '_devkit');
    expect(table).not.toBeNull();
    expect(table?.chainId).toBe(2030);
    expect(table?.localWETH).toBe('0xweth');
    expect(table?.entries).toHaveLength(1);
    expect(table?.entries[0].symbol).toBe('USDT');
    expect(table?.entries[0].localAddress).toBe('0xlocal');
    expect(table?.entries[0].realAddress).toBe('0xreal');
  });

  it('returns null when no entries have realAddress metadata', () => {
    const result = buildTranslationTableFromTrackedContracts([FACTORY, WETH9, ROUTER], '0xweth', 2030, '_devkit');
    expect(result).toBeNull();
  });

  it('returns null on empty list', () => {
    expect(buildTranslationTableFromTrackedContracts([], '0xweth', 2030, '_devkit')).toBeNull();
  });

  it('normalises addresses to lowercase', () => {
    const contract = makeContract({
      name: 'TOKEN_devkit',
      address: '0xABCD',
      metadata: { realAddress: '0xEF01', symbol: 'TKN', decimals: 6 },
    });
    const table = buildTranslationTableFromTrackedContracts([contract], '0xWETH', 2030, '_devkit');
    expect(table?.localWETH).toBe('0xweth');
    expect(table?.entries[0].localAddress).toBe('0xabcd');
    expect(table?.entries[0].realAddress).toBe('0xef01');
  });
});
