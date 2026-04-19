/**
 * views/dex.ts
 *
 * TreeDataProvider for the "DEX Pools" sidebar view.
 *
 * Displays deployed Uniswap V2 pools with live reserves and spot prices.
 * Reads v2-manifest.json for V2 stack addresses and translation-table.json
 * for mirrored token mappings. Reserves fetched via eth_call to each pair.
 *
 * Tree structure:
 *   DexHeaderItem (V2 stack status)
 *   └── PoolItem (TOKEN/CFX pair)
 *       └── PoolDetailItem (reserves, price)
 */

import * as vscode from "vscode";
import { getDeployedContracts } from "../conflux/api";

// ── Types (inline to avoid importing from shared — CJS/ESM boundary) ──────

interface V2Manifest {
	deployedAt: string;
	chainId: number;
	rpcUrl: string;
	deployer: string;
	contracts: { factory: string; weth9: string; router02: string };
	initCodeHash: string;
	wcfxPriceUsd?: number;
}

interface TranslationEntry {
	realAddress: string;
	localAddress: string;
	symbol: string;
	decimals: number;
	mirroredAt: number;
}

interface TranslationTable {
	chainId: number;
	localWETH: string;
	updatedAt: number;
	entries: TranslationEntry[];
}

interface PoolData {
	symbol: string;
	localAddress: string;
	quoteAddress?: string;
	quoteSymbol: string;
	pairAddress: string;
	decimals: number;
	reserve0: bigint;
	reserve1: bigint;
	spotPrice: number; // WCFX per token
	spotPriceUsd: number; // USD per token
}

async function getTokenAddress(
	pairAddress: string,
	selector: "0x0dfe1681" | "0xd21220a7",
): Promise<string | null> {
	try {
		const result = await ethCall(pairAddress, selector);
		if (result === "0x" || result.length < 66) return null;
		const addr = `0x${result.slice(26, 66)}`;
		if (addr === "0x0000000000000000000000000000000000000000") return null;
		return addr;
	} catch {
		return null;
	}
}

// ── Minimal RPC helper ────────────────────────────────────────────────────

function getEspaceRpc(): string {
	return (
		vscode.workspace.getConfiguration("cfxdevkit").get<string>("espaceRpc") ??
		"http://127.0.0.1:8545"
	);
}

async function ethCall(to: string, data: string): Promise<string> {
	const res = await fetch(getEspaceRpc(), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "eth_call",
			params: [{ to, data }, "latest"],
		}),
		signal: AbortSignal.timeout(5000),
	});
	const json = (await res.json()) as {
		result?: string;
		error?: { message: string };
	};
	if (json.error) throw new Error(json.error.message);
	return json.result ?? "0x";
}

// getReserves() selector = 0x0902f1ac
async function getReserves(
	pairAddress: string,
): Promise<{ reserve0: bigint; reserve1: bigint } | null> {
	try {
		const result = await ethCall(pairAddress, "0x0902f1ac");
		if (result === "0x" || result.length < 130) return null;
		// Decode: uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast
		const r0 = BigInt(`0x${result.slice(2, 66)}`);
		const r1 = BigInt(`0x${result.slice(66, 130)}`);
		return { reserve0: r0, reserve1: r1 };
	} catch {
		return null;
	}
}

// getPair(tokenA, tokenB) selector = 0xe6a43905
async function getPair(
	factoryAddress: string,
	tokenA: string,
	tokenB: string,
): Promise<string | null> {
	try {
		const a = tokenA.toLowerCase().replace("0x", "").padStart(64, "0");
		const b = tokenB.toLowerCase().replace("0x", "").padStart(64, "0");
		const result = await ethCall(factoryAddress, `0xe6a43905${a}${b}`);
		if (result === "0x" || result.length < 66) return null;
		const addr = `0x${result.slice(26, 66)}`;
		if (addr === "0x0000000000000000000000000000000000000000") return null;
		return addr;
	} catch {
		return null;
	}
}

// ── HTTP readers (state lives in DEX server's in-memory store) ─────────────

function getDexUrl(): string {
	const port =
		vscode.workspace.getConfiguration("cfxdevkit").get<number>("dexUiPort") ??
		8888;
	return `http://127.0.0.1:${port}`;
}

async function readManifest(): Promise<V2Manifest | null> {
	try {
		const r = await fetch(`${getDexUrl()}/api/dex/manifest`, {
			signal: AbortSignal.timeout(3_000),
		});
		if (!r.ok) return null;
		return (await r.json()) as V2Manifest | null;
	} catch {
		return null;
	}
}

async function readTranslationTable(): Promise<TranslationTable | null> {
	try {
		const r = await fetch(`${getDexUrl()}/api/dex/translation-table`, {
			signal: AbortSignal.timeout(3_000),
		});
		if (!r.ok) return null;
		return (await r.json()) as TranslationTable | null;
	} catch {
		return null;
	}
}

// ── Tree items ─────────────────────────────────────────────────────────────

/** Format a number without scientific notation, trimming trailing zeros. */
function fmtNum(n: number, maxDecimals = 8): string {
	if (n === 0) return "0";
	// For very small numbers, use enough decimals to show significant digits
	const abs = Math.abs(n);
	let dec = maxDecimals;
	if (abs >= 1) dec = 2;
	else if (abs >= 0.01) dec = 4;
	else if (abs >= 0.0001) dec = 6;
	// toFixed never uses scientific notation
	return parseFloat(n.toFixed(dec)).toString();
}

class DexHeaderItem extends vscode.TreeItem {
	constructor(deployed: boolean, pairCount: number) {
		super(
			deployed ? `V2 DEX — ${pairCount} pool(s)` : "V2 DEX — not deployed",
			deployed && pairCount > 0
				? vscode.TreeItemCollapsibleState.Expanded
				: vscode.TreeItemCollapsibleState.None,
		);
		this.iconPath = new vscode.ThemeIcon(deployed ? "pulse" : "circle-slash");
		this.contextValue = "cfxDexHeader";
		if (!deployed) {
			this.tooltip = "Run dex_deploy to deploy the Uniswap V2 stack";
		}
	}
}

class PoolItem extends vscode.TreeItem {
	constructor(readonly pool: PoolData) {
		const wcfxStr = pool.spotPrice > 0 ? fmtNum(pool.spotPrice) : "—";
		const usdStr = pool.spotPriceUsd > 0 ? `$${fmtNum(pool.spotPriceUsd)}` : "";
		const desc = usdStr
			? `${wcfxStr} ${pool.quoteSymbol} (${usdStr})`
			: `${wcfxStr} ${pool.quoteSymbol}`;
		super(
			`${pool.symbol}/${pool.quoteSymbol}`,
			vscode.TreeItemCollapsibleState.Collapsed,
		);
		this.description = desc;
		this.tooltip = [
			`${pool.symbol}/${pool.quoteSymbol}`,
			`Pair: ${pool.pairAddress}`,
			`Token: ${pool.localAddress}`,
			`Price: ${wcfxStr} ${pool.quoteSymbol} per ${pool.symbol}`,
			...(usdStr ? [`USD:   ${usdStr} per ${pool.symbol}`] : []),
		].join("\n");
		this.iconPath = new vscode.ThemeIcon("symbol-number");
		this.contextValue = "cfxDexPool";
		this.command = {
			command: "cfxdevkit.copyAddress",
			title: "Copy Pair Address",
			arguments: [pool.pairAddress],
		};
	}
}

class PoolDetailItem extends vscode.TreeItem {
	constructor(label: string, value: string, copyAddress?: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.description = value;
		this.iconPath = new vscode.ThemeIcon("info");
		this.contextValue = "cfxDexPoolDetail";
		if (copyAddress) {
			this.command = {
				command: "cfxdevkit.copyAddress",
				title: "Copy Address",
				arguments: [copyAddress],
			};
			this.tooltip = `${value}\nClick to copy`;
		}
	}
}

// ── Provider ──────────────────────────────────────────────────────────────

type DexTreeItem = DexHeaderItem | PoolItem | PoolDetailItem;

export class DexPoolsProvider
	implements vscode.TreeDataProvider<DexTreeItem>, vscode.Disposable
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		DexTreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private pools: PoolData[] = [];
	private manifest: V2Manifest | null = null;
	private _pollTimer: ReturnType<typeof setInterval> | undefined;

	constructor() {
		this.startPolling();
	}

	dispose(): void {
		if (this._pollTimer) clearInterval(this._pollTimer);
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	async load(): Promise<void> {
		this.manifest = await readManifest();
		this.pools = [];

		if (!this.manifest) {
			this.refresh();
			return;
		}

		const table = await readTranslationTable();
		if (table && table.entries.length > 0) {
			for (const entry of table.entries) {
				const pairAddress = await getPair(
					this.manifest.contracts.factory,
					entry.localAddress,
					this.manifest.contracts.weth9,
				);
				if (!pairAddress) continue;

				const reserves = await getReserves(pairAddress);
				let spotPrice = 0;

				// Uniswap V2 sorts pairs by address: token0 < token1.
				// Determine which reserve is the token vs WCFX.
				const isToken0 =
					entry.localAddress.toLowerCase() <
					this.manifest.contracts.weth9.toLowerCase();
				const tokenReserve = reserves
					? isToken0
						? reserves.reserve0
						: reserves.reserve1
					: 0n;
				const wcfxReserve = reserves
					? isToken0
						? reserves.reserve1
						: reserves.reserve0
					: 0n;

				if (tokenReserve > 0n) {
					const tR = Number(tokenReserve) / 10 ** entry.decimals;
					const wR = Number(wcfxReserve) / 10 ** 18;
					spotPrice = tR > 0 ? wR / tR : 0;
				}

				const wcfxUsd = this.manifest?.wcfxPriceUsd ?? 0;
				this.pools.push({
					symbol: entry.symbol,
					localAddress: entry.localAddress,
					quoteAddress: this.manifest.contracts.weth9,
					quoteSymbol: "CFX",
					pairAddress,
					decimals: entry.decimals,
					reserve0: tokenReserve,
					reserve1: wcfxReserve,
					spotPrice,
					spotPriceUsd: spotPrice * wcfxUsd,
				});
			}
		} else {
			// Fallback: translation table missing — still show deployed pairs with addresses and raw prices.
			const deployed = await getDeployedContracts().catch(() => []);
			const pairs = deployed.filter(
				(c) => c.chain === "evm" && /UniswapV2Pair/i.test(c.name ?? c.id ?? ""),
			);
			for (const pair of pairs) {
				const reserves = await getReserves(pair.address);
				const token0 = await getTokenAddress(pair.address, "0x0dfe1681");
				const token1 = await getTokenAddress(pair.address, "0xd21220a7");
				const r0 = reserves?.reserve0 ?? 0n;
				const r1 = reserves?.reserve1 ?? 0n;
				const spot = r0 > 0n ? Number(r1) / Number(r0) : 0;
				const sym0 = token0 ? `${token0.slice(2, 6).toUpperCase()}` : "TOK0";
				const sym1 = token1 ? `${token1.slice(2, 6).toUpperCase()}` : "TOK1";
				this.pools.push({
					symbol: sym0,
					localAddress: token0 ?? pair.address,
					quoteAddress: token1 ?? undefined,
					quoteSymbol: sym1,
					pairAddress: pair.address,
					decimals: 18,
					reserve0: r0,
					reserve1: r1,
					spotPrice: spot,
					spotPriceUsd: 0,
				});
			}
		}

		this.refresh();
	}

	getTreeItem(element: DexTreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(element?: DexTreeItem): DexTreeItem[] {
		if (!element) {
			// Root level
			const header = new DexHeaderItem(!!this.manifest, this.pools.length);
			if (!this.manifest || this.pools.length === 0) return [header];
			return [header, ...this.pools.map((p) => new PoolItem(p))];
		}

		if (element instanceof DexHeaderItem) {
			return [];
		}

		if (element instanceof PoolItem) {
			const p = element.pool;
			const r0Human = fmtNum(Number(p.reserve0) / 10 ** p.decimals);
			const r1Human = fmtNum(Number(p.reserve1) / 10 ** 18);
			const wcfxStr = fmtNum(p.spotPrice);
			const usdStr = p.spotPriceUsd > 0 ? ` ($${fmtNum(p.spotPriceUsd)})` : "";
			return [
				new PoolDetailItem("Pair Address", p.pairAddress, p.pairAddress),
				new PoolDetailItem(
					`${p.symbol} Address`,
					p.localAddress,
					p.localAddress,
				),
				...(p.quoteAddress
					? [
							new PoolDetailItem(
								`${p.quoteSymbol} Address`,
								p.quoteAddress,
								p.quoteAddress,
							),
						]
					: []),
				new PoolDetailItem(`Reserve (${p.symbol})`, `${r0Human} ${p.symbol}`),
				new PoolDetailItem(
					`Reserve (${p.quoteSymbol})`,
					`${r1Human} ${p.quoteSymbol}`,
				),
				new PoolDetailItem(
					"Price",
					`${wcfxStr} ${p.quoteSymbol}/${p.symbol}${usdStr}`,
				),
			];
		}

		return [];
	}

	// ── Polling ─────────────────────────────────────────────────────────────

	private startPolling(): void {
		this._pollTimer = setInterval(() => {
			this.load().catch(() => undefined);
		}, 15_000);
	}
}
