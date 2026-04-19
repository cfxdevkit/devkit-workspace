import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getDexSeedPoolSuggestions } from "../conflux/api.js";

interface DexKnownPoolTokenDescriptor {
	address: string;
	symbol: string;
	name: string;
	decimals: number;
}

interface DexKnownPoolEntry {
	address: string;
	label: string;
	baseToken: DexKnownPoolTokenDescriptor;
	quoteToken: DexKnownPoolTokenDescriptor;
	reserveUsd: number;
	volume24h: number;
	isWcfxPair: boolean;
}

interface DexKnownTokenCatalogFile {
	pools?: DexKnownPoolEntry[];
}

interface DexPoolImportPresetFile {
	selectedPoolAddresses?: string[];
}

interface DexPoolQuickPickItem extends vscode.QuickPickItem {
	address: string;
}

const DEFAULT_DEX_POOL_PRESETS: DexPoolQuickPickItem[] = [
	{
		label: "xCFX/WCFX",
		description: "Preset fallback",
		detail:
			"Fallback preset from the bundled DEX catalog • 0x949b78ef2c8d6979098e195b08f27ff99cb20448",
		picked: true,
		address: "0x949b78ef2c8d6979098e195b08f27ff99cb20448",
	},
	{
		label: "GCFX/WCFX",
		description: "Preset fallback",
		detail:
			"Fallback preset from the bundled DEX catalog • 0x371576f2ce309370a6234593f02953b09cdd2ed2",
		picked: true,
		address: "0x371576f2ce309370a6234593f02953b09cdd2ed2",
	},
	{
		label: "sCFX/WCFX",
		description: "Preset fallback",
		detail:
			"Fallback preset from the bundled DEX catalog • 0x41e9e50952d8a2e489d0b866b78835bc2ad2a0fa",
		picked: true,
		address: "0x41e9e50952d8a2e489d0b866b78835bc2ad2a0fa",
	},
	{
		label: "WCFX/WBTC",
		description: "Preset fallback",
		detail:
			"Fallback preset from the bundled DEX catalog • 0x8bbbd6150c933fcd790b4a00bab23826912c192c",
		picked: true,
		address: "0x8bbbd6150c933fcd790b4a00bab23826912c192c",
	},
	{
		label: "WCFX/PPI",
		description: "Preset fallback",
		detail:
			"Fallback preset from the bundled DEX catalog • 0x1112a6c61a2eec4bd3aec78bd5bf3396bdd37d57",
		picked: true,
		address: "0x1112a6c61a2eec4bd3aec78bd5bf3396bdd37d57",
	},
];

const DEX_STABLECOIN_ADDRESSES = new Set([
	"0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff",
	"0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e",
	"0xfe97e85d13abd9c1c33384e796f10b73905637ce",
	"0x6963efed0ab40f6c3d7bda44a05dcf1437c44372",
	"0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
	"0xdac17f958d2ee523a2206206994597c13d831ec7",
	"0x6b175474e89094c44da98b954eedeac495271d0f",
]);

function readJsonFile<T>(filePath: string): T | null {
	try {
		if (!fs.existsSync(filePath)) return null;
		return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
	} catch {
		return null;
	}
}

function resolveDexDataFile(
	workspaceRoot: string,
	extensionPath: string,
	relativePath: string,
): string | null {
	const candidates = [
		// Primary: verified path in devkit-devcontainer:local image (npm global install)
		path.join(
			"/usr/local/lib/node_modules/@devkit/devkit-dex-ui/public",
			relativePath,
		),
		// Secondary npm install layouts
		path.join(
			"/usr/lib/node_modules/@devkit/devkit-dex-ui/public",
			relativePath,
		),
		path.join("/usr/local/lib/node_modules/devkit-dex-ui/public", relativePath),
		// Legacy container layout (/opt/devkit)
		path.join("/opt/devkit/apps/dex-ui/public", relativePath),
		// Workspace-relative paths (development / monorepo)
		path.join(workspaceRoot, "apps", "dex-ui", "public", relativePath),
		path.join(workspaceRoot, "dex-ui", "public", relativePath),
		// Extension-relative paths (last resort)
		path.resolve(
			extensionPath,
			"..",
			"..",
			"apps",
			"dex-ui",
			"public",
			relativePath,
		),
		path.resolve(
			extensionPath,
			"..",
			"..",
			"..",
			"apps",
			"dex-ui",
			"public",
			relativePath,
		),
	];

	for (const candidate of candidates) {
		if (fs.existsSync(candidate)) return candidate;
	}

	return null;
}

function isDexStablecoinAddress(address: string): boolean {
	return DEX_STABLECOIN_ADDRESSES.has(address.toLowerCase());
}

function isDexStablecoinPool(pool: DexKnownPoolEntry): boolean {
	return (
		isDexStablecoinAddress(pool.baseToken.address) ||
		isDexStablecoinAddress(pool.quoteToken.address)
	);
}

function getSuggestedDexPoolAddresses(
	pools: DexKnownPoolEntry[],
	limit = 20,
): string[] {
	return pools
		.filter((pool) => pool.isWcfxPair && !isDexStablecoinPool(pool))
		.sort((left, right) => {
			if (left.reserveUsd !== right.reserveUsd)
				return right.reserveUsd - left.reserveUsd;
			return right.volume24h - left.volume24h;
		})
		.slice(0, limit)
		.map((pool) => pool.address.toLowerCase());
}

function formatCompactUsd(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return "$0";
	if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
	return `$${value.toFixed(0)}`;
}

async function showDexPoolPicker(
	picks: DexPoolQuickPickItem[],
	placeHolder: string,
): Promise<string[] | undefined> {
	const selected = await vscode.window.showQuickPick(picks, {
		title: "DEX: Select Source Pools",
		placeHolder,
		canPickMany: true,
		ignoreFocusOut: true,
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (selected === undefined) return undefined;
	if (selected.length === 0) return [];
	return selected.map((item) => item.address);
}

export async function pickDexSeedStablecoins(): Promise<string[] | undefined> {
	const allStablecoins = [
		{
			symbol: "USDT0",
			label: "USDT0",
			detail: "Tether USD (OFT) - 6 decimals, $1.00",
		},
		{
			symbol: "AxCNH",
			label: "AxCNH",
			detail: "Axelar Bridged CNH - 6 decimals, $0.137",
		},
		{
			symbol: "USDT",
			label: "USDT",
			detail: "Tether USD (mirror) - 18 decimals, $1.00",
		},
		{
			symbol: "USDC",
			label: "USDC",
			detail: "USD Coin (mirror) - 18 decimals, $1.00",
		},
	];
	const defaultSymbols = new Set(["USDT0", "AxCNH"]);

	const picks = allStablecoins.map((stablecoin) => ({
		label: stablecoin.label,
		detail: stablecoin.detail,
		picked: defaultSymbols.has(stablecoin.symbol),
		symbol: stablecoin.symbol,
	}));

	const selected = await vscode.window.showQuickPick(picks, {
		title: "DEX: Select Stablecoins to Deploy",
		placeHolder:
			"Choose which stablecoins to deploy and seed. Accept defaults or customize.",
		canPickMany: true,
		ignoreFocusOut: true,
	});

	if (selected === undefined) return undefined;
	return selected.map((item) => item.symbol);
}

export async function pickDexSeedPools(params: {
	workspaceRoot: string;
	extensionPath: string;
}): Promise<string[] | null | undefined> {
	const { workspaceRoot, extensionPath } = params;

	// Prefer the local known-tokens catalog (instant, no network wait)
	const catalogPath = resolveDexDataFile(
		workspaceRoot,
		extensionPath,
		"known-tokens.json",
	);
	if (catalogPath) {
		const catalog = readJsonFile<DexKnownTokenCatalogFile>(catalogPath);
		const pools = (catalog?.pools ?? [])
			.filter((pool) => !isDexStablecoinPool(pool))
			.slice()
			.sort((left, right) => {
				if (left.reserveUsd !== right.reserveUsd)
					return right.reserveUsd - left.reserveUsd;
				return right.volume24h - left.volume24h;
			});
		if (pools.length > 0) {
			const presetPath = resolveDexDataFile(
				workspaceRoot,
				extensionPath,
				"pool-import-presets.json",
			);
			const presets = presetPath
				? readJsonFile<DexPoolImportPresetFile>(presetPath)
				: null;
			const presetAddresses = (presets?.selectedPoolAddresses ?? [])
				.filter(
					(address): address is string =>
						typeof address === "string" && address.length > 0,
				)
				.map((address) => address.toLowerCase());
			const defaultSelection = new Set(
				(presetAddresses.length > 0
					? presetAddresses
					: getSuggestedDexPoolAddresses(pools)
				).map((address) => address.toLowerCase()),
			);

			const picks = pools.map<DexPoolQuickPickItem>((pool) => ({
				label: pool.label,
				description: pool.isWcfxPair ? "WCFX pair" : undefined,
				detail: `${formatCompactUsd(pool.reserveUsd)} liquidity • ${formatCompactUsd(pool.volume24h)} 24h • ${pool.address}`,
				picked: defaultSelection.has(pool.address.toLowerCase()),
				address: pool.address.toLowerCase(),
			}));

			return showDexPoolPicker(
				picks,
				"Choose the source pools to import. Accept the preselected top pools or customize them.",
			);
		}
	}

	// Fallback: fetch live suggestions from the backend (slower, hits GeckoTerminal)
	try {
		const response = await getDexSeedPoolSuggestions();
		const liveSuggestions = response.suggestions ?? [];
		if (liveSuggestions.length > 0) {
			const picks = liveSuggestions.map<DexPoolQuickPickItem>((pool) => ({
				label: pool.label,
				description: "WCFX pair",
				detail: `${formatCompactUsd(pool.reserveUsd)} liquidity • ${formatCompactUsd(pool.volume24h)} 24h • ${pool.address}`,
				picked: true,
				address: pool.address.toLowerCase(),
			}));
			return showDexPoolPicker(
				picks,
				"Choose the source pools to import. Fetched live from GeckoTerminal (no local catalog found).",
			);
		}
	} catch {
		// Fall back to bundled presets.
	}

	return showDexPoolPicker(
		DEFAULT_DEX_POOL_PRESETS,
		"Choose the source pools to import. Using bundled fallback presets because no local catalog was found.",
	);
}
