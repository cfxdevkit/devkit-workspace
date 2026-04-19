/**
 * dex-simulation.ts
 *
 * SimulationEngine — replays GeckoTerminal OHLCV candle history as on-chain
 * swap operations against a local Uniswap V2 deployment.
 *
 * Architecture: the engine handles candle iteration, averaging, deviation
 * calculation, and rebalance orchestration. Actual chain interactions
 * (swaps, reserve reads, snapshots) are delegated to a ChainAdapter provided
 * by the MCP layer — this keeps the shared package CJS-compatible.
 *
 * Phase 3 of the CFX DevKit hackathon plan.
 */

import type { FeedCache, VWAPPoint } from "./dex-feed.js";
import {
	computeSwapAmountForTargetPrice,
	reservesToPrice,
} from "./dex-reserves.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Convert raw pair reserves (address-sorted) to canonical (token, WETH) order.
 * In UniswapV2, token0 = min(address). If the mirror token IS token0, then
 * reserve0 = tokenReserve and reserve1 = wethReserve. Otherwise they're swapped.
 */
function sortReserves(
	raw: { reserve0: bigint; reserve1: bigint },
	isToken0: boolean,
): { tokenReserve: bigint; wethReserve: bigint } {
	return isToken0
		? { tokenReserve: raw.reserve0, wethReserve: raw.reserve1 }
		: { tokenReserve: raw.reserve1, wethReserve: raw.reserve0 };
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EngineConfig {
	/** Minimum price change in basis points to trigger rebalance (default: 50 = 0.5%) */
	minDeviationBps: number;
	/** Above this bps threshold, use injection instead of swap (default: 5000 = 50%) */
	maxDeviationBps: number;
	/** Rebalance method: 'swap' | 'inject' | 'auto' (default: 'auto') */
	rebalanceMethod: "swap" | "inject" | "auto";
	/** Fraction of real liquidity for local reserves (default: 0.01) */
	reserveScaleFactor: number;
	/** Milliseconds between auto-ticks. 0 = max speed (default: 0) */
	tickIntervalMs: number;
	/** Rolling average window size in candles (default: 3) */
	windowSize: number;
	/** Weight rolling average by volume (default: true) */
	weightByVol: boolean;
	/** Reject candles > N std deviations from window mean (default: 2.5) */
	outlierSigmas: number;
	/** Log each tick and rebalance op (default: false) */
	verbose: boolean;
}

export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
	minDeviationBps: 50,
	maxDeviationBps: 5000,
	rebalanceMethod: "auto",
	reserveScaleFactor: 0.01,
	tickIntervalMs: 0,
	windowSize: 3,
	weightByVol: true,
	outlierSigmas: 2.5,
	verbose: false,
};

/** Result of a single rebalance operation */
export interface RebalanceResult {
	symbol: string;
	method: "swap" | "inject" | "skipped";
	priceBefore: number;
	priceAfter: number;
	targetPrice: number;
	deviationBps: number;
	amountIn?: string; // bigint as string
	txHash?: string;
	error?: string;
}

/** Result of one tick (processes one candle per token) */
export interface TickResult {
	tick: number;
	timestamp: number; // candle timestamp of this tick
	processed: number; // tokens rebalanced
	skipped: number; // tokens below minDeviation
	exhausted: number; // tokens with no more candles
	results: RebalanceResult[];
	done: boolean; // all tokens exhausted
}

/** Aggregate statistics */
export interface TickStats {
	ticks: number;
	rebalances: number;
	swapsSent: number;
	injectsDone: number;
	skipped: number;
	errors: number;
}

/** Per-token simulation state */
export interface TokenSimState {
	symbol: string;
	realAddress: string; // mainnet address (for feed lookup)
	localAddress: string;
	pairAddress: string;
	decimals: number;
	isToken0: boolean; // true if mirror token is token0 in the V2 pair (address-sorted)
	candleIndex: number; // next candle to consume
	totalCandles: number;
	window: VWAPPoint[]; // rolling window for averaging
	initialPrice: number; // on-chain WCFX price at seeding time (stable baseline)
	lastPrice: number; // last on-chain price after rebalance
	exhausted: boolean;
}

export type EngineState = "idle" | "running" | "paused" | "destroyed";

/** Progress info */
export interface SimulationProgress {
	processed: number;
	total: number;
	percent: number;
}

// ── Chain adapter interface ───────────────────────────────────────────────────
// Implemented by the MCP layer using @cfxdevkit/core

export interface ChainAdapter {
	/** Read current reserves for a V2 pair */
	getReserves(
		pairAddress: string,
	): Promise<{ reserve0: bigint; reserve1: bigint }>;

	/** Execute a swap through the Router to move price */
	executeSwap(params: {
		routerAddress: string;
		tokenIn: string;
		tokenOut: string;
		amountIn: bigint;
		accountIndex: number;
	}): Promise<{ txHash: string }>;

	/** Direct reserve injection (setStorageAt + mint + sync) */
	executeInjection(params: {
		pairAddress: string;
		tokenAddress: string;
		wethAddress: string;
		tokenReserve: bigint;
		wethReserve: bigint;
		accountIndex: number;
	}): Promise<void>;

	/** Take an EVM snapshot (for reset) */
	takeSnapshot(): Promise<string>;

	/** Revert to a previously taken snapshot */
	revertSnapshot(snapshotId: string): Promise<void>;

	/** Mine a single block (to confirm pending txs) */
	mineBlock(): Promise<void>;
}

// ── Averaging logic ──────────────────────────────────────────────────────────

/**
 * Compute smoothed price from a rolling window of candles.
 * Applies VWAP weighting (optional) and outlier rejection.
 */
export function computeSmoothedPrice(
	window: VWAPPoint[],
	weightByVol: boolean,
	outlierSigmas: number,
): number {
	if (window.length === 0) return 0;
	if (window.length === 1) return window[0].price;

	// Step 1: compute mean and stddev for outlier detection
	const prices = window.map((c) => c.price);
	const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
	const variance =
		prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
	const stddev = Math.sqrt(variance);

	// Step 2: filter outliers
	const threshold = outlierSigmas * stddev;
	const filtered =
		threshold > 0
			? window.filter((c) => Math.abs(c.price - mean) <= threshold)
			: window;

	if (filtered.length === 0) return mean; // all outliers — use raw mean

	// Step 3: weighted average
	if (weightByVol) {
		const totalVol = filtered.reduce((s, c) => s + Math.max(c.volume, 1), 0);
		if (totalVol > 0) {
			return (
				filtered.reduce((s, c) => s + c.price * Math.max(c.volume, 1), 0) /
				totalVol
			);
		}
	}

	// Equal-weight fallback
	return filtered.reduce((s, c) => s + c.price, 0) / filtered.length;
}

/**
 * Calculate deviation in basis points between two prices.
 * Returns absolute deviation (always >= 0).
 */
export function deviationBps(
	currentPrice: number,
	targetPrice: number,
): number {
	if (currentPrice <= 0) return 10000; // 100% deviation if no current price
	return Math.round(
		(Math.abs(targetPrice - currentPrice) / currentPrice) * 10000,
	);
}

// ── SimulationEngine ─────────────────────────────────────────────────────────

export class SimulationEngine {
	readonly config: EngineConfig;

	private state: EngineState = "idle";
	private tokens: TokenSimState[] = [];
	private stats: TickStats = {
		ticks: 0,
		rebalances: 0,
		swapsSent: 0,
		injectsDone: 0,
		skipped: 0,
		errors: 0,
	};
	private tickCount = 0;
	private snapshotId: string | null = null;
	private stopFn: (() => void) | null = null;

	// Injected dependencies
	private adapter: ChainAdapter;
	private routerAddress: string;
	private wethAddress: string;
	private accountIndex: number;

	private constructor(
		adapter: ChainAdapter,
		routerAddress: string,
		wethAddress: string,
		accountIndex: number,
		config: EngineConfig,
	) {
		this.adapter = adapter;
		this.routerAddress = routerAddress;
		this.wethAddress = wethAddress;
		this.accountIndex = accountIndex;
		this.config = config;
	}

	/**
	 * Factory method — validates feed data, initializes per-token state,
	 * and optionally takes a snapshot for reset().
	 */
	static async create(params: {
		adapter: ChainAdapter;
		routerAddress: string;
		wethAddress: string;
		accountIndex: number;
		feedCache: FeedCache;
		/** Maps token realAddress (lowercase) → { localAddress, pairAddress } */
		tokenMap: Map<string, { localAddress: string; pairAddress: string }>;
		config?: Partial<EngineConfig>;
		takeSnapshot?: boolean;
	}): Promise<SimulationEngine> {
		const config = { ...DEFAULT_ENGINE_CONFIG, ...params.config };
		const engine = new SimulationEngine(
			params.adapter,
			params.routerAddress,
			params.wethAddress,
			params.accountIndex,
			config,
		);

		// Initialize per-token state
		for (const token of params.feedCache.tokens) {
			const mapping = params.tokenMap.get(token.realAddress.toLowerCase());
			if (!mapping) continue; // token not mirrored
			if (token.candles.length === 0) continue; // no history

			// Determine token ordering: UniswapV2 sorts by address
			const isToken0 =
				mapping.localAddress.toLowerCase() < params.wethAddress.toLowerCase();

			// Read initial on-chain price (account for token ordering)
			const reserves = await params.adapter.getReserves(mapping.pairAddress);
			const { tokenReserve, wethReserve } = sortReserves(reserves, isToken0);
			const currentPrice = reservesToPrice(
				tokenReserve,
				wethReserve,
				token.decimals,
			);

			engine.tokens.push({
				symbol: token.symbol,
				realAddress: token.realAddress.toLowerCase(),
				localAddress: mapping.localAddress,
				pairAddress: mapping.pairAddress,
				decimals: token.decimals,
				isToken0,
				candleIndex: 0,
				totalCandles: token.candles.length,
				window: [],
				initialPrice: currentPrice,
				lastPrice: currentPrice,
				exhausted: false,
			});
		}

		// Take snapshot for reset()
		if (params.takeSnapshot !== false) {
			engine.snapshotId = await params.adapter.takeSnapshot();
		}

		return engine;
	}

	// ── Lifecycle methods ────────────────────────────────────────────────────

	/**
	 * Execute one tick: advance one candle per token, compute smoothed prices,
	 * and rebalance where deviation exceeds threshold.
	 */
	async step(feedCache: FeedCache): Promise<TickResult> {
		if (this.state === "destroyed") {
			throw new Error("Engine is destroyed");
		}

		this.tickCount++;
		const result: TickResult = {
			tick: this.tickCount,
			timestamp: 0,
			processed: 0,
			skipped: 0,
			exhausted: 0,
			results: [],
			done: false,
		};

		for (const ts of this.tokens) {
			if (ts.exhausted) {
				result.exhausted++;
				continue;
			}

			// Find this token's candle data in the feed cache
			const feedToken = feedCache.tokens.find(
				(t) =>
					t.realAddress.toLowerCase() ===
					this.getTokenRealAddress(ts, feedCache),
			);
			if (!feedToken || ts.candleIndex >= feedToken.candles.length) {
				ts.exhausted = true;
				result.exhausted++;
				continue;
			}

			// Advance candle
			const candle = feedToken.candles[ts.candleIndex];
			ts.candleIndex++;

			// Skip zero-volume candles
			if (candle.volume === 0 || candle.price <= 0) {
				result.skipped++;
				this.stats.skipped++;
				continue;
			}

			// Update rolling window
			ts.window.push(candle);
			if (ts.window.length > this.config.windowSize) {
				ts.window.shift();
			}

			// Compute smoothed target price (in WCFX terms)
			// Candle prices are in USD — convert to WCFX using ratio
			// Since all pairs quote against WCFX, we need the priceUsd / wcfxPriceUsd ratio
			// But candle VWAP is already relative — we use the ratio of candle price to initial price
			// to compute target price in WCFX terms
			const smoothedUsd = computeSmoothedPrice(
				ts.window,
				this.config.weightByVol,
				this.config.outlierSigmas,
			);

			// Target WCFX price: scaled from USD candle price
			// initial ratio: feedToken.priceUsd = X USD, initial onchain price = Y WCFX
			// target WCFX price = (smoothedUsd / feedToken.priceUsd) * initialOnchainPrice
			// We approximate using the spot price at feed fetch time
			const priceRatio =
				feedToken.priceUsd > 0 ? smoothedUsd / feedToken.priceUsd : 1;
			// Use the FIRST candle's price as baseline for the ratio, since the initial
			// reserves were seeded at feedToken.priceUsd
			const targetPrice =
				ts.initialPrice > 0 ? priceRatio * ts.initialPrice : ts.lastPrice;

			if (targetPrice <= 0) {
				result.skipped++;
				this.stats.skipped++;
				continue;
			}

			result.timestamp = candle.timestamp;

			// Read current on-chain reserves (sort to canonical token/WETH order)
			const rawReserves = await this.adapter.getReserves(ts.pairAddress);
			const { tokenReserve, wethReserve } = sortReserves(
				rawReserves,
				ts.isToken0,
			);
			const currentPrice = reservesToPrice(
				tokenReserve,
				wethReserve,
				ts.decimals,
			);

			const deviation = deviationBps(currentPrice, targetPrice);

			if (deviation < this.config.minDeviationBps) {
				result.skipped++;
				this.stats.skipped++;
				result.results.push({
					symbol: ts.symbol,
					method: "skipped",
					priceBefore: currentPrice,
					priceAfter: currentPrice,
					targetPrice,
					deviationBps: deviation,
				});
				continue;
			}

			// Determine rebalance method
			let method: "swap" | "inject";
			if (this.config.rebalanceMethod === "auto") {
				method = deviation > this.config.maxDeviationBps ? "inject" : "swap";
			} else {
				method = this.config.rebalanceMethod;
			}

			const rbResult: RebalanceResult = {
				symbol: ts.symbol,
				method,
				priceBefore: currentPrice,
				priceAfter: currentPrice,
				targetPrice,
				deviationBps: deviation,
			};

			try {
				if (method === "swap") {
					await this.rebalanceViaSwap(
						ts,
						{ tokenReserve, wethReserve },
						targetPrice,
						rbResult,
					);
				} else {
					await this.rebalanceViaInjection(
						ts,
						{ tokenReserve, wethReserve },
						targetPrice,
						rbResult,
					);
				}

				// Read post-rebalance price
				const newRaw = await this.adapter.getReserves(ts.pairAddress);
				const newSorted = sortReserves(newRaw, ts.isToken0);
				rbResult.priceAfter = reservesToPrice(
					newSorted.tokenReserve,
					newSorted.wethReserve,
					ts.decimals,
				);
				ts.lastPrice = rbResult.priceAfter;

				result.processed++;
				this.stats.rebalances++;
				if (method === "swap") this.stats.swapsSent++;
				else this.stats.injectsDone++;
			} catch (err) {
				rbResult.error = String(err).split("\n")[0];
				this.stats.errors++;
			}

			result.results.push(rbResult);
		}

		this.stats.ticks++;

		// Check if all tokens are exhausted
		result.done = this.tokens.every((t) => t.exhausted);

		if (this.config.verbose) {
			const label = `[tick ${result.tick}] processed=${result.processed} skipped=${result.skipped} exhausted=${result.exhausted}`;
			console.log(label); // eslint-disable-line no-console
		}

		return result;
	}

	/**
	 * Start continuous auto-tick loop. Returns a stop function.
	 */
	start(feedCache: FeedCache): () => void {
		if (this.state === "running") {
			throw new Error("Engine already running");
		}
		if (this.state === "destroyed") {
			throw new Error("Engine is destroyed");
		}

		this.state = "running";
		let cancelled = false;

		const loop = async () => {
			while (!cancelled && this.state === "running") {
				const result = await this.step(feedCache);
				if (result.done) {
					this.state = "idle";
					break;
				}
				if (this.config.tickIntervalMs > 0) {
					await new Promise((r) => setTimeout(r, this.config.tickIntervalMs));
				}
			}
		};

		// Run loop in background
		loop().catch((err) => {
			if (this.config.verbose) {
				console.error("[SimulationEngine] loop error:", err); // eslint-disable-line no-console
			}
			this.state = "idle";
		});

		this.stopFn = () => {
			cancelled = true;
			this.state = "idle";
		};

		return this.stopFn;
	}

	/** Pause the auto-tick loop (if running) */
	pause(): void {
		if (this.state === "running") {
			this.state = "paused";
		}
	}

	/** Resume the auto-tick loop after pause */
	resume(feedCache: FeedCache): void {
		if (this.state === "paused") {
			this.start(feedCache);
		}
	}

	/** Revert to the post-seed snapshot */
	async reset(): Promise<void> {
		if (this.stopFn) {
			this.stopFn();
			this.stopFn = null;
		}
		if (this.snapshotId) {
			await this.adapter.revertSnapshot(this.snapshotId);
			// Re-take snapshot (Anvil snapshots are consumed on revert)
			this.snapshotId = await this.adapter.takeSnapshot();
		}
		// Reset per-token state
		for (const ts of this.tokens) {
			ts.candleIndex = 0;
			ts.window = [];
			ts.exhausted = false;
		}
		this.tickCount = 0;
		this.stats = {
			ticks: 0,
			rebalances: 0,
			swapsSent: 0,
			injectsDone: 0,
			skipped: 0,
			errors: 0,
		};
		this.state = "idle";
	}

	/** Tear down the engine */
	destroy(): void {
		if (this.stopFn) {
			this.stopFn();
			this.stopFn = null;
		}
		this.state = "destroyed";
		this.tokens = [];
	}

	// ── State queries ──────────────────────────────────────────────────────

	getState(): EngineState {
		return this.state;
	}
	getTickCount(): number {
		return this.tickCount;
	}
	getTickStats(): TickStats {
		return { ...this.stats };
	}
	getTokenCount(): number {
		return this.tokens.length;
	}

	getCurrentPrices(): Record<string, number> {
		const prices: Record<string, number> = {};
		for (const ts of this.tokens) {
			prices[ts.symbol] = ts.lastPrice;
		}
		return prices;
	}

	getProgress(): SimulationProgress {
		let processed = 0;
		let total = 0;
		for (const ts of this.tokens) {
			processed += ts.candleIndex;
			total += ts.totalCandles;
		}
		return {
			processed,
			total,
			percent: total > 0 ? Math.round((processed / total) * 100) : 0,
		};
	}

	getTokenStates(): ReadonlyArray<Readonly<TokenSimState>> {
		return this.tokens;
	}

	// ── Private rebalance methods ──────────────────────────────────────────

	private async rebalanceViaSwap(
		ts: TokenSimState,
		reserves: { tokenReserve: bigint; wethReserve: bigint },
		targetPrice: number,
		result: RebalanceResult,
	): Promise<void> {
		// reserves are already in canonical (token, WETH) order
		const currentPrice = reservesToPrice(
			reserves.tokenReserve,
			reserves.wethReserve,
			ts.decimals,
		);

		if (targetPrice < currentPrice) {
			// Price needs to go DOWN → sell token, buy WCFX
			// computeSwapAmountForTargetPrice expects (r0=token, r1=WETH)
			const amountIn = computeSwapAmountForTargetPrice(
				reserves.tokenReserve,
				reserves.wethReserve,
				targetPrice,
				ts.decimals,
			);
			if (amountIn === 0n) return;

			result.amountIn = amountIn.toString();
			const { txHash } = await this.adapter.executeSwap({
				routerAddress: this.routerAddress,
				tokenIn: ts.localAddress,
				tokenOut: this.wethAddress,
				amountIn,
				accountIndex: this.accountIndex,
			});
			result.txHash = txHash;
		} else {
			// Price needs to go UP → sell WCFX, buy token
			// For reverse direction: swap reserves and invert price
			const amountIn = computeSwapAmountForTargetPrice(
				reserves.wethReserve, // now "reserve0" = WCFX
				reserves.tokenReserve, // now "reserve1" = token
				1 / targetPrice, // invert price for reverse direction
				18, // WCFX decimals as "dec0"
				ts.decimals, // token decimals as "dec1"
			);
			if (amountIn === 0n) return;

			result.amountIn = amountIn.toString();
			const { txHash } = await this.adapter.executeSwap({
				routerAddress: this.routerAddress,
				tokenIn: this.wethAddress,
				tokenOut: ts.localAddress,
				amountIn,
				accountIndex: this.accountIndex,
			});
			result.txHash = txHash;
		}
	}

	private async rebalanceViaInjection(
		ts: TokenSimState,
		reserves: { tokenReserve: bigint; wethReserve: bigint },
		targetPrice: number,
		result: RebalanceResult,
	): Promise<void> {
		// For injection: compute target reserves maintaining constant product k
		// reserves are in canonical (token, WETH) order
		const k = reserves.tokenReserve * reserves.wethReserve;

		// target: wethReserve_norm / tokenReserve_norm = targetPrice
		// newToken = sqrt(k * 10^decToken / (targetPrice * 10^decWeth))
		const scale = BigInt(10 ** 18);
		const decTokB = BigInt(10 ** ts.decimals);
		const decWethB = BigInt(10 ** 18); // WETH decimals
		const tpScaled = BigInt(Math.round(targetPrice * 1e18));

		if (tpScaled === 0n) return;

		const tokenSq = (k * decTokB * scale) / (tpScaled * decWethB);
		const newTokenReserve = bigIntSqrt(tokenSq);
		const newWethReserve = k / (newTokenReserve === 0n ? 1n : newTokenReserve);

		result.amountIn = `inject token=${newTokenReserve} weth=${newWethReserve}`;

		await this.adapter.executeInjection({
			pairAddress: ts.pairAddress,
			tokenAddress: ts.localAddress,
			wethAddress: this.wethAddress,
			tokenReserve: newTokenReserve,
			wethReserve: newWethReserve,
			accountIndex: this.accountIndex,
		});
	}

	/** Find a token's feed data from feed cache */
	private getTokenRealAddress(
		ts: TokenSimState,
		_feedCache: FeedCache,
	): string {
		return ts.realAddress;
	}
}

// ── Utility: integer square root (duplicated from dex-reserves for standalone use)

function bigIntSqrt(n: bigint): bigint {
	if (n < 0n) throw new Error("sqrt of negative");
	if (n < 2n) return n;
	let x = n / 2n;
	for (;;) {
		const y = (x + n / x) / 2n;
		if (y >= x) return x;
		x = y;
	}
}
