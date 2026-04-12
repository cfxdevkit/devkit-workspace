/**
 * dex-reserves.ts
 *
 * ReserveCalculator — translates GeckoTerminal price + liquidity data into
 * Uniswap V2 raw reserve amounts (bigint) for pool seeding and price simulation.
 *
 * All local V2 pairs use WCFX (local WETH9) as the quote token.
 * ETH price is fixed at fetch time — simulation tracks relative movements only.
 *
 * CRITICAL: Always work in normalized (human-readable) form internally.
 * Convert to raw bigint only at the very end. A decimals mismatch causes
 * reserve calculations to be wrong by 10^(delta) with no error thrown.
 */

import type { TokenFeedData } from './dex-feed';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReservePair {
  reserve0: bigint;   // token0 (mirror token) raw amount
  reserve1: bigint;   // token1 (WCFX) raw amount
}

export interface ReserveState {
  reserve0Normalized: number;   // reserve0 / 10^decimals0
  reserve1Normalized: number;   // reserve1 / 10^decimals1
  spotPrice:          number;   // token0 in terms of token1 (WCFX-denominated)
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const WETH_DECIMALS = 18;

/**
 * Default scale factor: 1% of mainnet liquidity.
 * Keeps reserve bigints manageable on the local devnet.
 * Use 0.001 for micro-cap tokens (price ratio > 1,000,000:1 vs WCFX).
 */
export const DEFAULT_RESERVE_SCALE = 0.01;

// ── Core math ─────────────────────────────────────────────────────────────────

/**
 * Integer square root via Newton's method.
 * Used in computeSwapAmountForTargetPrice.
 */
function bigIntSqrt(n: bigint): bigint {
  if (n < 0n) throw new Error('sqrt of negative');
  if (n < 2n) return n;
  let x = n / 2n;
  for (;;) {
    const y = (x + n / x) / 2n;
    if (y >= x) return x;
    x = y;
  }
}

// ── Reserve calculation ────────────────────────────────────────────────────────

/**
 * Compute initial raw reserves for a token/WCFX pool.
 *
 * Formula:
 *   halfUsd = (reserveUsd * scaleFactor) / 2
 *   amount0 = halfUsd / priceUsd          (token0 units)
 *   amount1 = halfUsd / wcfxPriceUsd      (WCFX units)
 *   reserve0 = floor(amount0 * 10^dec0)
 *   reserve1 = floor(amount1 * 10^dec1)
 *
 * token1 is always WCFX. wcfxPriceUsd is fixed for the entire session.
 */
export function computeInitialReserves(
  token:          TokenFeedData,
  wcfxPriceUsd:   number,
  scaleFactor:    number = DEFAULT_RESERVE_SCALE,
): ReservePair {
  if (token.priceUsd <= 0) throw new Error(`${token.symbol}: priceUsd must be > 0`);
  if (wcfxPriceUsd <= 0) throw new Error('wcfxPriceUsd must be > 0');
  if (token.reserveUsd <= 0) throw new Error(`${token.symbol}: reserveUsd must be > 0`);

  const localReserveUsd = token.reserveUsd * scaleFactor;
  const halfUsd         = localReserveUsd / 2;

  const amount0 = halfUsd / token.priceUsd;
  const amount1 = halfUsd / wcfxPriceUsd;

  const reserve0 = BigInt(Math.floor(amount0 * (10 ** token.decimals)));
  const reserve1 = BigInt(Math.floor(amount1 * (10 ** WETH_DECIMALS)));

  if (reserve0 === 0n || reserve1 === 0n) {
    throw new Error(
      `${token.symbol}: reserves computed as zero. ` +
      `price=$${token.priceUsd} reserve=$${token.reserveUsd} scale=${scaleFactor}. ` +
      'Try a larger scaleFactor or manually seed this token.'
    );
  }

  return { reserve0, reserve1 };
}

/**
 * Convert raw reserves to normalized spot price (token0 in terms of token1).
 * price = reserve1_normalized / reserve0_normalized
 */
export function reservesToPrice(
  reserve0: bigint,
  reserve1: bigint,
  dec0:     number,
  dec1:     number = WETH_DECIMALS,
): number {
  const r0 = Number(reserve0) / (10 ** dec0);
  const r1 = Number(reserve1) / (10 ** dec1);
  if (r0 === 0) return 0;
  return r1 / r0;
}

/**
 * Convert a price (token0 in units of token1) to the reserve ratio.
 * ratio = reserve1/reserve0 (normalized)
 */
export function priceToReserveRatio(
  price: number,
  dec0:  number,
  dec1:  number = WETH_DECIMALS,
): number {
  // normalized price = (reserve1 / 10^dec1) / (reserve0 / 10^dec0)
  //                  = price * 10^dec1 / 10^dec0  ?  No — price IS reserve1_norm/reserve0_norm
  // ratio = price  (already in normalized terms)
  return price * (10 ** dec0) / (10 ** dec1);
}

/**
 * Given current reserves and a target price, compute new reserves that achieve
 * exactly that price while preserving the constant product (k = r0 * r1).
 *
 * Note: this does NOT account for the swap fee. It computes ideal target
 * reserves for the injection method. For swap method, use computeSwapAmount.
 */
export function computeTargetReserves(
  currentR0:   bigint,
  currentR1:   bigint,
  targetPrice: number,   // token0 in terms of token1 (normalized)
  dec0:        number,
  dec1:        number = WETH_DECIMALS,
): ReservePair {
  // k = r0 * r1  (constant product)
  // target: r1_norm / r0_norm = targetPrice
  //   r1_norm = r1 / 10^dec1 ;  r0_norm = r0 / 10^dec0
  //   (r1 / 10^dec1) = targetPrice * (r0 / 10^dec0)
  //   r1 = targetPrice * r0 * 10^dec1 / 10^dec0
  //   substituting into k = r0 * r1:
  //   k = r0 * targetPrice * r0 * 10^dec1 / 10^dec0
  //   r0^2 = k * 10^dec0 / (targetPrice * 10^dec1)
  //   r0 = sqrt(k * 10^dec0 / (targetPrice * 10^dec1))

  const k = currentR0 * currentR1;

  // Scale to avoid precision loss: multiply numerator by 1e18 (tpScaled is already scaled by 1e18)
  const scale   = BigInt(10 ** 18);
  const dec01   = BigInt(10 ** dec0);
  const dec11   = BigInt(10 ** dec1);
  const tpScaled = BigInt(Math.round(targetPrice * 1e18));

  // r0^2 = k * 10^dec0 / (targetPrice * 10^dec1)
  //       = k * dec01 * scale / (tpScaled * dec11)    [since tpScaled = targetPrice * scale]
  const r0Sq = k * dec01 * scale / (tpScaled * dec11);
  const r0   = bigIntSqrt(r0Sq);
  const r1   = k / (r0 === 0n ? 1n : r0);

  return { reserve0: r0, reserve1: r1 };
}

/**
 * Compute the exact amountIn (token0 → token1) needed to move the pool price
 * from current to targetPrice via a single V2 swap, accounting for the 0.3% fee.
 *
 * Returns 0n if the price is already at or beyond the target, or if targetPrice
 * would require buying token1 (i.e., swapping token1→token0).
 *
 * Math:
 *   V2 invariant (with fee): (r0 + amountIn * 997/1000) * newR1 = k
 *   Target: newR1 / newR0_eff = targetPrice (normalized)
 *   → newR0_eff = sqrt(k / targetPrice_raw)  where k in raw terms
 *   → grossAmountIn = newR0_eff - r0
 *   → amountInWithFee = grossAmountIn * 1000 / 997
 */
export function computeSwapAmountForTargetPrice(
  reserve0:    bigint,  // current reserve0 (token0)
  reserve1:    bigint,  // current reserve1 (token1 = WCFX)
  targetPrice: number,  // desired token0 price in WCFX (normalized)
  dec0:        number,
  dec1:        number = WETH_DECIMALS,
  feeFactor:   bigint  = 997n,
): bigint {
  const currentPrice = reservesToPrice(reserve0, reserve1, dec0, dec1);

  // Only swap token0 → token1 if price needs to go DOWN (more token0 in)
  // For price going UP, the swap is token1 → token0 (caller handles direction)
  if (targetPrice >= currentPrice) return 0n;

  const k = reserve0 * reserve1;

  // target price in raw integer form: targetPrice * 10^dec1 / 10^dec0
  // newR0_eff such that (newR1) / newR0_eff = targetPrice
  // with k = newR0_eff * newR1
  // → newR0_eff = sqrt(k * 10^dec0 / (targetPrice * 10^dec1))
  const scale    = BigInt(10 ** 18);
  const dec0b    = BigInt(10 ** dec0);
  const dec1b    = BigInt(10 ** dec1);
  const tpScaled = BigInt(Math.round(targetPrice * 1e18));

  const r0SqRaw = k * dec0b * scale / (tpScaled * dec1b);
  const newEffR0 = bigIntSqrt(r0SqRaw);

  if (newEffR0 <= reserve0) return 0n;

  const grossAmountIn = newEffR0 - reserve0;
  // Gross-up for 0.3% fee: amountIn * 997 = gross * 1000
  return grossAmountIn * 1000n / feeFactor;
}

/**
 * Convenience: get current reserve state as normalized values + price.
 */
export function getReserveState(
  reserve0: bigint,
  reserve1: bigint,
  dec0:     number,
  dec1:     number = WETH_DECIMALS,
): ReserveState {
  const r0 = Number(reserve0) / (10 ** dec0);
  const r1 = Number(reserve1) / (10 ** dec1);
  return {
    reserve0Normalized: r0,
    reserve1Normalized: r1,
    spotPrice:          r0 > 0 ? r1 / r0 : 0,
  };
}

/**
 * Determine scale factor for a token based on price ratio vs WCFX.
 * Micro-cap tokens (extreme ratio) need a smaller scale to avoid overflow.
 */
export function autoScaleFactor(priceUsd: number, wcfxPriceUsd: number): number {
  if (wcfxPriceUsd <= 0 || priceUsd <= 0) return DEFAULT_RESERVE_SCALE;
  const ratio = wcfxPriceUsd / priceUsd;
  if (ratio > 1_000_000) return 0.001;
  if (ratio > 100_000)   return 0.005;
  return DEFAULT_RESERVE_SCALE;
}
