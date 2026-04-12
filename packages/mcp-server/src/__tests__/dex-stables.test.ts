import { describe, expect, it } from 'vitest';
import { STABLECOIN_DEFS, STABLE_CROSS_PAIRS, stablecoinSymbols } from '../features/dex/dex-stables.js';

describe('STABLECOIN_DEFS', () => {
  it('contains the four canonical stablecoins', () => {
    const symbols = STABLECOIN_DEFS.map((d) => d.symbol);
    expect(symbols).toContain('USDT0');
    expect(symbols).toContain('AxCNH');
    expect(symbols).toContain('USDT');
    expect(symbols).toContain('USDC');
  });

  it('all real addresses are lowercase hex', () => {
    for (const def of STABLECOIN_DEFS) {
      expect(def.realAddress).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it('all decimals are 6 or 18', () => {
    for (const def of STABLECOIN_DEFS) {
      expect([6, 18]).toContain(def.decimals);
    }
  });

  it('all mintAmounts are positive bigints', () => {
    for (const def of STABLECOIN_DEFS) {
      expect(def.mintAmount).toBeTypeOf('bigint');
      expect(def.mintAmount > 0n).toBe(true);
    }
  });

  it('all priceUsd values are positive', () => {
    for (const def of STABLECOIN_DEFS) {
      expect(def.priceUsd).toBeGreaterThan(0);
    }
  });
});

describe('stablecoinSymbols', () => {
  it('returns all four symbols', () => {
    const symbols = stablecoinSymbols();
    expect(symbols).toHaveLength(4);
    expect(symbols).toEqual(['USDT0', 'AxCNH', 'USDT', 'USDC']);
  });

  it('output matches STABLECOIN_DEFS order', () => {
    expect(stablecoinSymbols()).toEqual(STABLECOIN_DEFS.map((d) => d.symbol));
  });
});

describe('STABLE_CROSS_PAIRS', () => {
  it('is an empty array by default', () => {
    expect(STABLE_CROSS_PAIRS).toEqual([]);
  });
});
