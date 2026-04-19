import * as fs from "node:fs";
import * as path from "node:path";
import { wrappedCfxAbi, wrappedCfxBytecode } from "@cfxdevkit/contracts";
import {
	autoScaleFactor,
	computeInitialReserves,
	type FeedCache,
	isNativeToken,
	isStablecoin,
	refreshSelectedTokenSourcesCache,
	reservesToPrice,
	type TokenFeedData,
	TokenMirror,
	type TokenSourceSelection,
} from "@devkit/shared";
import { Router } from "express";
import {
	createPublicClient,
	createWalletClient,
	defineChain,
	http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contractStorage, type StoredContract } from "../contract-storage.js";
import { deployEvm, sleep } from "../deploy-helpers.js";
import {
	_init_code_hash,
	MirrorERC20,
	UniswapV2Factory,
	UniswapV2Router02,
} from "../dex/artifacts.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { asyncHandler } from "../middleware.js";
import type { NodeManager } from "../node-manager.js";

interface DexManifest {
	deployedAt: string;
	chainId: number;
	rpcUrl: string;
	deployer: string;
	contracts: {
		factory: string;
		weth9: string;
		router02: string;
	};
	stables?: Record<string, StableEntry>;
	initCodeHash: string;
	wcfxPriceUsd?: number;
}

interface StableEntry {
	symbol: string;
	name: string;
	decimals: number;
	address: string;
}

interface TranslationTableEntry {
	realAddress: string;
	localAddress: string;
	symbol: string;
	decimals: number;
	iconCached: boolean;
	mirroredAt: number;
}

interface TranslationTable {
	chainId: number;
	localWETH: string;
	updatedAt: number;
	entries: TranslationTableEntry[];
}

interface DexPriceSnapshot {
	usd: number;
	source: "coingecko" | "geckoterminal" | "fallback";
	fetchedAt: number;
}

interface SeedRefreshRequest {
	chainId: number;
	tokenSelections: TokenSourceSelection[];
	forceRefresh?: boolean;
	maxAgeMs?: number;
}

interface DexPoolSuggestion {
	address: string;
	label: string;
	reserveUsd: number;
	volume24h: number;
}

interface GtPoolAttributes {
	address: string;
	name: string;
	base_token_price_usd: string;
	quote_token_price_usd: string;
	reserve_in_usd: string;
	volume_usd: { h24: string };
}

interface GtPoolRelationships {
	base_token: { data: { id: string } };
	quote_token: { data: { id: string } };
}

interface GtPool {
	id: string;
	attributes: GtPoolAttributes;
	relationships: GtPoolRelationships;
}

interface DexWalletContext {
	rpcUrl: string;
	chainId: number;
	privateKey: `0x${string}`;
	deployer: `0x${string}`;
	localManager: ReturnType<NodeManager["getManager"]>;
}

interface StablecoinDef {
	symbol: string;
	name: string;
	decimals: number;
	mintAmount: bigint;
	priceUsd: number;
	realAddress: string;
}

const DEVKIT_NAME_SUFFIX = " (DevKit)";
const REGISTRY_SUFFIX = "__devkit";
const GT_BASE = "https://api.geckoterminal.com/api/v2";
const MAINNET_CHAIN_ID = 1030;
const PRICE_CACHE_TTL_MS = 30_000;
const PRICE_FALLBACK_USD = 0.05;
const WCFX_MAINNET = "0x14b2d3bc65e74dae1030eafd8ac30c533c976a9b";
const TOKEN_PAIR_GAS_BUFFER_WEI = 15n * 10n ** 18n;
const STABLE_PAIR_GAS_BUFFER_WEI = 20n * 10n ** 18n;
const DEFAULT_POOL_SUGGESTION_LIMIT = 20;
const MIN_SUGGESTED_POOL_RESERVE_USD = 10_000;
const DEX_DEPLOY_GAS_LIMIT = 12_000_000n;

// ── Funding constants (progressive mining + chunked bridging) ──────────
const CFX_PER_BLOCK = 7;
const FUNDING_MINE_BATCH = 250;
const FUNDING_BRIDGE_CHUNK = 5_000;

const STABLECOIN_DEFS: StablecoinDef[] = [
	{
		symbol: "USDT0",
		name: "USDT0",
		decimals: 6,
		mintAmount: 10_000_000n * 10n ** 6n,
		priceUsd: 1.0,
		realAddress: "0xaf37e8b6c9ed7f6318979f56fc287d76c30847ff",
	},
	{
		symbol: "AxCNH",
		name: "Axelar Bridged CNH",
		decimals: 6,
		mintAmount: 10_000_000n * 10n ** 6n,
		priceUsd: 0.137,
		realAddress: "0x70bfd7f7eadf9b9827541272589a6b2bb760ae2e",
	},
	{
		symbol: "USDT",
		name: "Tether USD",
		decimals: 18,
		mintAmount: 10_000_000n * 10n ** 18n,
		priceUsd: 1.0,
		realAddress: "0xfe97e85d13abd9c1c33384e796f10b73905637ce",
	},
	{
		symbol: "USDC",
		name: "USD Coin",
		decimals: 18,
		mintAmount: 10_000_000n * 10n ** 18n,
		priceUsd: 1.0,
		realAddress: "0x6963efed0ab40f6c3d7bda44a05dcf1437c44372",
	},
];

// ── Known-tokens catalog (offline pool resolution) ─────────────────────
//
// The known-tokens.json catalog is baked into the dex-ui at build time.
// Using it for seeding eliminates ALL GeckoTerminal calls — no 429 risk,
// no network roundtrips, instant pool resolution.

interface CatalogTokenDescriptor {
	address: string;
	symbol: string;
	name: string;
	decimals: number;
}
interface CatalogPoolEntry {
	address: string;
	label: string;
	baseToken: CatalogTokenDescriptor;
	quoteToken: CatalogTokenDescriptor;
	reserveUsd: number;
	volume24h: number;
	baseTokenPriceUsd: number;
	quoteTokenPriceUsd: number;
	isWcfxPair: boolean;
}

let catalogCache: { pools: CatalogPoolEntry[]; loadedAt: number } | null = null;
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;

function loadCatalogPools(): CatalogPoolEntry[] {
	if (
		catalogCache &&
		Date.now() - catalogCache.loadedAt < CATALOG_CACHE_TTL_MS
	) {
		return catalogCache.pools;
	}
	const candidates = [
		"/usr/local/lib/node_modules/@devkit/devkit-dex-ui/dist/known-tokens.json", // npm global (devcontainer): Next.js build output
		"/usr/local/lib/node_modules/@devkit/devkit-dex-ui/public/known-tokens.json", // npm global: pre-built source
		"/usr/lib/node_modules/@devkit/devkit-dex-ui/dist/known-tokens.json", // alternate npm global
		"/usr/lib/node_modules/@devkit/devkit-dex-ui/public/known-tokens.json", // alternate npm global (source)
		"/opt/devkit/apps/dex-ui/public/known-tokens.json", // legacy
		path.resolve("apps/dex-ui/public/known-tokens.json"), // monorepo dev
		path.resolve("apps/dex-ui/dist/known-tokens.json"), // monorepo dev (built)
	];
	for (const filePath of candidates) {
		try {
			if (!fs.existsSync(filePath)) continue;
			const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
				pools?: CatalogPoolEntry[];
			};
			if (Array.isArray(data.pools) && data.pools.length > 0) {
				catalogCache = { pools: data.pools, loadedAt: Date.now() };
				return data.pools;
			}
		} catch {
			/* skip */
		}
	}
	return [];
}

/** Resolve pools + build FeedCache entirely from the known-tokens catalog (no network). */
function resolvePoolsFromCatalog(poolAddresses: string[]): {
	tokenSelections: TokenSourceSelection[];
	feed: FeedCache;
} | null {
	const catalog = loadCatalogPools();
	if (catalog.length === 0) return null;

	const byAddress = new Map(catalog.map((p) => [p.address.toLowerCase(), p]));
	const tokenSelections: TokenSourceSelection[] = [];
	const tokens: TokenFeedData[] = [];
	let wcfxPriceUsd: number | undefined;

	for (const addr of poolAddresses) {
		const entry = byAddress.get(addr.toLowerCase());
		if (!entry) return null; // pool missing from catalog — must fall back to live API

		const baseAddr = entry.baseToken.address.toLowerCase();
		const quoteAddr = entry.quoteToken.address.toLowerCase();
		const baseIsWcfx = isNativeToken(baseAddr);

		if (baseIsWcfx && !isStablecoin(quoteAddr)) {
			tokenSelections.push({
				tokenAddress: quoteAddr,
				poolAddress: entry.address.toLowerCase(),
				quoteMode: true,
			});
			if (!wcfxPriceUsd) wcfxPriceUsd = entry.baseTokenPriceUsd;
		} else if (isNativeToken(quoteAddr) && !isStablecoin(baseAddr)) {
			tokenSelections.push({
				tokenAddress: baseAddr,
				poolAddress: entry.address.toLowerCase(),
				quoteMode: false,
			});
			if (!wcfxPriceUsd) wcfxPriceUsd = entry.quoteTokenPriceUsd;
		} else {
			continue; // not a usable WCFX pair
		}

		const tokenEntry = baseIsWcfx ? entry.quoteToken : entry.baseToken;
		const priceUsd = baseIsWcfx
			? entry.quoteTokenPriceUsd
			: entry.baseTokenPriceUsd;

		tokens.push({
			realAddress: tokenEntry.address.toLowerCase(),
			poolAddress: entry.address.toLowerCase(),
			symbol: tokenEntry.symbol,
			name: tokenEntry.name,
			decimals: tokenEntry.decimals,
			iconCached: false,
			priceUsd: priceUsd || 0,
			reserveUsd: entry.reserveUsd || 0,
			volume24h: entry.volume24h || 0,
			candles: [],
		});
	}

	if (tokenSelections.length === 0) return null;

	return {
		tokenSelections,
		feed: {
			version: "1.0",
			chainId: MAINNET_CHAIN_ID,
			chain: "cfx",
			fetchedAt: Date.now(),
			delayMs: 0,
			wcfxPriceUsd,
			tokens,
		},
	};
}

let cachedManifest: DexManifest | null = null;
let cachedTranslationTable: TranslationTable | null = null;
let cachedWcfxUsd: DexPriceSnapshot | null = null;

export async function clearDexRuntimeState(): Promise<void> {
	cachedManifest = null;
	cachedTranslationTable = null;
	cachedWcfxUsd = null;
	await mirrorToDexUi("/api/dex/state", { method: "DELETE" });
}

function clearTrackedDexContracts(chainId?: number): number {
	const contracts = contractStorage.list("evm");
	let removed = 0;
	for (const contract of contracts) {
		if (!contract.name.endsWith(REGISTRY_SUFFIX)) continue;
		if (chainId !== undefined && contract.chainId !== chainId) continue;
		if (contractStorage.delete(contract.id)) removed += 1;
	}
	return removed;
}

async function hasEvmContractCode(
	rpcUrl: string,
	chainId: number,
	address: string,
): Promise<boolean> {
	try {
		const chain = defineChain({
			id: chainId,
			name: "Conflux eSpace",
			nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
			rpcUrls: { default: { http: [rpcUrl] } },
		});
		const client = createPublicClient({
			chain,
			transport: http(rpcUrl, { timeout: 30_000 }),
		});
		const code = await client.getCode({ address: address as `0x${string}` });
		return typeof code === "string" && code !== "0x";
	} catch {
		return false;
	}
}

function getDexUiUrl(): string {
	return process.env.DEX_URL ?? "http://localhost:8888";
}

async function mirrorToDexUi(path: string, init: RequestInit): Promise<void> {
	try {
		await fetch(`${getDexUiUrl()}${path}`, {
			...init,
			signal: init.signal ?? AbortSignal.timeout(3_000),
		});
	} catch {
		// Optional mirror only.
	}
}

function normalizeAddress(id: string): string {
	const idx = id.indexOf("_0x");
	return (idx >= 0 ? id.slice(idx + 1) : id).toLowerCase();
}

function trackedTimestamp(
	contract: Pick<StoredContract, "deployedAt">,
): number {
	const value = Date.parse(contract.deployedAt);
	return Number.isFinite(value) ? value : 0;
}

function findLatestTrackedContract(
	contracts: StoredContract[],
	predicate: (contract: StoredContract) => boolean,
): StoredContract | null {
	let latest: StoredContract | null = null;
	for (const contract of contracts) {
		if (!predicate(contract)) continue;
		if (!latest || trackedTimestamp(contract) >= trackedTimestamp(latest)) {
			latest = contract;
		}
	}
	return latest;
}

function findTrackedContractByName(
	contracts: StoredContract[],
	name: string,
): StoredContract | null {
	return findLatestTrackedContract(
		contracts,
		(contract) => contract.name === name,
	);
}

function findTrackedContractByRealAddress(
	contracts: StoredContract[],
	realAddress: string,
): StoredContract | null {
	const normalized = realAddress.toLowerCase();
	return findLatestTrackedContract(contracts, (contract) => {
		const metadata = contract.metadata ?? {};
		return (
			typeof metadata.realAddress === "string" &&
			metadata.realAddress.toLowerCase() === normalized
		);
	});
}

function buildManifestFromTrackedContracts(
	contracts: StoredContract[],
	rpcUrl: string,
	chainId: number,
): DexManifest | null {
	const factory = findTrackedContractByName(
		contracts,
		`UniswapV2Factory${REGISTRY_SUFFIX}`,
	);
	const weth9 = findTrackedContractByName(contracts, `WETH9${REGISTRY_SUFFIX}`);
	const router = findTrackedContractByName(
		contracts,
		`UniswapV2Router02${REGISTRY_SUFFIX}`,
	);
	if (!factory || !weth9 || !router) return null;

	return {
		deployedAt: factory.deployedAt,
		chainId,
		rpcUrl,
		deployer: factory.deployer,
		contracts: {
			factory: factory.address,
			weth9: weth9.address,
			router02: router.address,
		},
		stables:
			factory.metadata && typeof factory.metadata.stables === "object"
				? (factory.metadata.stables as Record<string, StableEntry>)
				: undefined,
		initCodeHash:
			typeof factory.metadata?.initCodeHash === "string"
				? factory.metadata.initCodeHash
				: _init_code_hash.computed,
		wcfxPriceUsd:
			typeof factory.metadata?.wcfxPriceUsd === "number"
				? factory.metadata.wcfxPriceUsd
				: undefined,
	};
}

function buildTranslationTableFromTrackedContracts(
	contracts: StoredContract[],
	localWETH: string,
	chainId: number,
): TranslationTable | null {
	const entries = contracts
		.filter((contract) => typeof contract.metadata?.realAddress === "string")
		.map((contract) => {
			const metadata = contract.metadata ?? {};
			return {
				realAddress: String(metadata.realAddress).toLowerCase(),
				localAddress: contract.address.toLowerCase(),
				symbol:
					typeof metadata.symbol === "string"
						? metadata.symbol
						: contract.name.replace(REGISTRY_SUFFIX, ""),
				decimals:
					typeof metadata.decimals === "number" ? metadata.decimals : 18,
				iconCached: false,
				mirroredAt: trackedTimestamp(contract),
			};
		})
		.sort((left, right) => left.symbol.localeCompare(right.symbol));

	if (!entries.length) return null;

	return {
		chainId,
		localWETH: localWETH.toLowerCase(),
		updatedAt: Date.now(),
		entries,
	};
}

function saveDexContract(input: {
	name: string;
	address: string;
	chainId: number;
	deployer: string;
	abi: readonly unknown[];
	metadata?: Record<string, unknown>;
}): StoredContract {
	return contractStorage.add({
		id: `evm-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		name: input.name,
		address: input.address,
		chain: "evm",
		chainId: input.chainId,
		txHash: "",
		deployer: input.deployer,
		deployedAt: new Date().toISOString(),
		abi: [...input.abi],
		constructorArgs: [],
		metadata: input.metadata,
	});
}

function readTrackedDexContracts(chainId: number): StoredContract[] {
	return contractStorage
		.list("evm")
		.filter((contract) => contract.chainId === chainId);
}

async function fetchWcfxPriceFromProviders(): Promise<DexPriceSnapshot> {
	const now = Date.now();
	if (cachedWcfxUsd && now - cachedWcfxUsd.fetchedAt < PRICE_CACHE_TTL_MS) {
		return cachedWcfxUsd;
	}

	try {
		const res = await fetch(
			"https://api.coingecko.com/api/v3/simple/price?ids=conflux-token&vs_currencies=usd",
			{
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(5_000),
			},
		);
		const json = (await res.json()) as { "conflux-token"?: { usd?: number } };
		const usd = json["conflux-token"]?.usd ?? 0;
		if (Number.isFinite(usd) && usd > 0) {
			cachedWcfxUsd = { usd, source: "coingecko", fetchedAt: Date.now() };
			return cachedWcfxUsd;
		}
	} catch {
		// fall through
	}

	try {
		const url = `https://api.geckoterminal.com/api/v2/networks/cfx/tokens/${WCFX_MAINNET}`;
		const res = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(5_000),
		});
		const json = (await res.json()) as {
			data?: { attributes?: { price_usd?: string } };
		};
		const usd = parseFloat(json?.data?.attributes?.price_usd ?? "");
		if (Number.isFinite(usd) && usd > 0) {
			cachedWcfxUsd = { usd, source: "geckoterminal", fetchedAt: Date.now() };
			return cachedWcfxUsd;
		}
	} catch {
		// fall through
	}

	cachedWcfxUsd = {
		usd: PRICE_FALLBACK_USD,
		source: "fallback",
		fetchedAt: Date.now(),
	};
	return cachedWcfxUsd;
}

async function gtFetch(urlPath: string, attempt = 0): Promise<unknown> {
	const MAX_RETRIES = 6;
	const response = await fetch(`${GT_BASE}${urlPath}`, {
		headers: { Accept: "application/json;version=20230302" },
		signal: AbortSignal.timeout(20_000),
	});
	if (response.status === 429 || response.status === 503) {
		if (attempt >= MAX_RETRIES) {
			throw new Error(
				`GeckoTerminal ${urlPath} -> HTTP ${response.status} (exhausted ${MAX_RETRIES} retries)`,
			);
		}
		const retryAfter = Number(response.headers.get("Retry-After") ?? "0");
		// GeckoTerminal free tier: 30 req/min. Back off generously.
		const backoffMs =
			retryAfter > 0
				? retryAfter * 1000
				: Math.min(2000 * 2 ** attempt, 60_000);
		await new Promise((resolve) => setTimeout(resolve, backoffMs));
		return gtFetch(urlPath, attempt + 1);
	}
	if (!response.ok) {
		throw new Error(`GeckoTerminal ${urlPath} -> HTTP ${response.status}`);
	}
	return response.json();
}

async function fetchTopPools(page: number): Promise<GtPool[]> {
	const data = (await gtFetch(
		`/networks/cfx/pools?page=${page}&sort=h24_volume_usd_desc`,
	)) as { data: GtPool[] };
	return data.data ?? [];
}

async function fetchPoolsMulti(poolAddresses: string[]): Promise<GtPool[]> {
	if (poolAddresses.length === 0) return [];
	// GeckoTerminal recommends ≤10 addresses per multi-request; chunk to stay safe.
	const CHUNK = 8;
	const results: GtPool[] = [];
	for (let i = 0; i < poolAddresses.length; i += CHUNK) {
		const chunk = poolAddresses.slice(i, i + CHUNK);
		const data = (await gtFetch(
			`/networks/cfx/pools/multi/${chunk.join(",")}`,
		)) as { data: GtPool[] };
		results.push(...(data.data ?? []));
		if (i + CHUNK < poolAddresses.length) {
			// brief courtesy delay between chunks to avoid hammering the rate limit
			await new Promise((resolve) => setTimeout(resolve, 400));
		}
	}
	return results;
}

function toSourceSelection(pool: GtPool): TokenSourceSelection | null {
	const poolAddress = normalizeAddress(pool.attributes.address);
	const baseAddr = normalizeAddress(pool.relationships.base_token.data.id);
	const quoteAddr = normalizeAddress(pool.relationships.quote_token.data.id);

	if (
		isNativeToken(baseAddr) &&
		!isNativeToken(quoteAddr) &&
		!isStablecoin(quoteAddr)
	) {
		return { tokenAddress: quoteAddr, poolAddress, quoteMode: true };
	}
	if (
		isNativeToken(quoteAddr) &&
		!isNativeToken(baseAddr) &&
		!isStablecoin(baseAddr)
	) {
		return { tokenAddress: baseAddr, poolAddress, quoteMode: false };
	}
	return null;
}

async function listSuggestedSourcePools(
	limit = DEFAULT_POOL_SUGGESTION_LIMIT,
): Promise<DexPoolSuggestion[]> {
	const suggestions: DexPoolSuggestion[] = [];
	const seen = new Set<string>();

	for (let page = 1; page <= 12 && suggestions.length < limit; page += 1) {
		const pools = await fetchTopPools(page);
		if (!pools.length) break;

		for (const pool of pools) {
			const selection = toSourceSelection(pool);
			if (!selection || seen.has(selection.poolAddress)) continue;
			const reserveUsd = parseFloat(pool.attributes.reserve_in_usd) || 0;
			if (reserveUsd < MIN_SUGGESTED_POOL_RESERVE_USD) continue;
			seen.add(selection.poolAddress);
			suggestions.push({
				address: selection.poolAddress,
				label: pool.attributes.name,
				reserveUsd,
				volume24h: parseFloat(pool.attributes.volume_usd.h24) || 0,
			});
			if (suggestions.length >= limit) break;
		}
	}

	return suggestions;
}

async function resolveSelectedPoolInputs(input: unknown): Promise<{
	tokenSelections: TokenSourceSelection[];
	selectedPools: Array<{ address: string; label: string }>;
	warnings: string[];
}> {
	const requested = Array.isArray(input)
		? input
				.filter(
					(value): value is string =>
						typeof value === "string" && value.length > 0,
				)
				.map((value) => value.toLowerCase())
		: [];
	const selectedAddresses =
		requested.length > 0
			? [...new Set(requested)]
			: (await listSuggestedSourcePools()).map((pool) => pool.address);

	if (selectedAddresses.length === 0) {
		return { tokenSelections: [], selectedPools: [], warnings: [] };
	}

	const pools = await fetchPoolsMulti(selectedAddresses);
	const poolsByAddress = new Map(
		pools.map((pool) => [normalizeAddress(pool.attributes.address), pool]),
	);
	const tokenSelections: TokenSourceSelection[] = [];
	const selectedPools: Array<{ address: string; label: string }> = [];
	const warnings: string[] = [];

	for (const address of selectedAddresses) {
		const pool = poolsByAddress.get(address);
		if (!pool) {
			warnings.push(
				`Selected pool ${address} was not returned by GeckoTerminal.`,
			);
			continue;
		}
		const selection = toSourceSelection(pool);
		if (!selection) {
			warnings.push(
				`Selected pool ${pool.attributes.name} is not an importable WCFX pair.`,
			);
			continue;
		}
		tokenSelections.push(selection);
		selectedPools.push({
			address: selection.poolAddress,
			label: pool.attributes.name,
		});
	}

	return { tokenSelections, selectedPools, warnings };
}

async function createDexWalletContext(
	nodeManager: NodeManager,
	accountIndex = 0,
): Promise<DexWalletContext> {
	const profile = nodeManager.getNetworkProfile();
	const chainIds = nodeManager.getEffectiveChainIds();

	if (profile.mode === "public") {
		const signer = await nodeManager.resolveSignerForPublicMode({
			chain: "evm",
			accountIndex,
		});
		const rpcUrl = profile.public.evmRpcUrl;
		if (!rpcUrl) {
			throw new ValidationError("Missing public eSpace RPC URL");
		}
		const account = privateKeyToAccount(signer.privateKey);
		return {
			rpcUrl,
			chainId: chainIds.evmChainId,
			privateKey: signer.privateKey,
			deployer: account.address,
			localManager: null,
		};
	}

	const manager = nodeManager.requireManager();
	const accounts = manager.getAccounts();
	const account = accounts[accountIndex];
	if (!account) {
		throw new ValidationError(`Account index ${accountIndex} not found`);
	}
	const rpcUrls = manager.getRpcUrls();
	return {
		rpcUrl: rpcUrls.evm,
		chainId: chainIds.evmChainId,
		privateKey: (account.evmPrivateKey ?? account.privateKey) as `0x${string}`,
		deployer: account.evmAddress as `0x${string}`,
		localManager: manager,
	};
}

class DexWallet {
	private readonly publicClient;
	private readonly walletClient;

	constructor(private readonly context: DexWalletContext) {
		const chain = defineChain({
			id: context.chainId,
			name: "Conflux eSpace",
			nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
			rpcUrls: { default: { http: [context.rpcUrl] } },
		});
		const account = privateKeyToAccount(context.privateKey);
		this.publicClient = createPublicClient({
			chain,
			transport: http(context.rpcUrl, { timeout: 30_000 }),
		});
		this.walletClient = createWalletClient({
			account,
			chain,
			transport: http(context.rpcUrl, { timeout: 30_000 }),
		});
	}

	async deployContract(
		abi: readonly unknown[],
		bytecode: string,
		args: unknown[],
	): Promise<string> {
		const { hash, pollReceipt } = await deployEvm({
			bytecode: bytecode as `0x${string}`,
			abi: [...abi],
			args,
			privateKey: this.context.privateKey,
			rpcUrl: this.context.rpcUrl,
			chainId: this.context.chainId,
			gas: DEX_DEPLOY_GAS_LIMIT,
		});

		if (this.context.localManager) {
			await this.context.localManager.packMine();
			for (let index = 0; index < 120; index += 1) {
				let address = null;
				try {
					address = await pollReceipt();
				} catch (error) {
					if (error instanceof Error && /revert/i.test(error.message))
						throw error;
				}
				if (address) return address;
				await this.context.localManager.mine(1);
				await sleep(300);
			}
			throw new Error(`Deployment timed out for ${hash}`);
		}

		for (let index = 0; index < 120; index += 1) {
			let address = null;
			try {
				address = await pollReceipt();
			} catch (error) {
				if (error instanceof Error && /revert/i.test(error.message))
					throw error;
			}
			if (address) return address;
			await sleep(800);
		}
		throw new Error(`Deployment timed out for ${hash}`);
	}

	async writeAndWait(
		address: `0x${string}`,
		abi: readonly unknown[],
		functionName: string,
		args: unknown[],
		value = 0n,
	): Promise<void> {
		const hash = await this.walletClient.writeContract({
			address,
			abi: abi as never,
			functionName: functionName as never,
			args: args as never,
			value: value > 0n ? value : undefined,
			gas: 5_000_000n,
		});

		if (this.context.localManager) {
			await this.context.localManager.packMine();
			for (let index = 0; index < 30; index += 1) {
				const receipt = await this.publicClient
					.getTransactionReceipt({ hash })
					.catch(() => null);
				if (receipt) {
					if (receipt.status === "reverted") {
						throw new Error(`Transaction reverted for ${functionName}`);
					}
					return;
				}
				await this.context.localManager.mine(1);
				await sleep(250);
			}
			throw new Error(`Transaction timed out for ${functionName}`);
		}

		const receipt = await this.publicClient.waitForTransactionReceipt({
			hash,
			timeout: 30_000,
			pollingInterval: 800,
		});
		if (receipt.status === "reverted") {
			throw new Error(`Transaction reverted for ${functionName}`);
		}
	}

	getBalanceWei(address: `0x${string}`): Promise<bigint> {
		return this.publicClient.getBalance({ address });
	}
}

/** Callback for streaming progress lines to clients in real time. */
type ProgressEmitter = (line: string) => void;

/** No-op emitter for non-streaming callers. */
const noopEmitter: ProgressEmitter = () => {};

async function ensureFunding(
	wallet: DexWallet,
	context: DexWalletContext,
	requiredWei: bigint,
	label: string,
	fundingLines: string[],
	emit: ProgressEmitter = noopEmitter,
): Promise<void> {
	if (requiredWei <= 0n) return;
	const current = await wallet.getBalanceWei(context.deployer);
	if (current >= requiredWei) return;

	if (!context.localManager) {
		throw new Error(
			`${label}: insufficient balance (${current} < ${requiredWei})`,
		);
	}

	const deficitWei = requiredWei - current;
	const deficitCfx = Math.ceil(Number(deficitWei) / 1e18);

	fundingLines.push(
		`  💰 ${label}: need ${(Number(requiredWei) / 1e18).toFixed(1)} CFX, have ${(Number(current) / 1e18).toFixed(1)} CFX`,
	);
	emit(
		`  💰 ${label}: need ${(Number(requiredWei) / 1e18).toFixed(1)} CFX, have ${(Number(current) / 1e18).toFixed(1)} CFX`,
	);

	// Phase 1: Mine blocks so the Core faucet account accumulates block rewards
	const blocksNeeded = Math.max(1, Math.ceil(deficitCfx / CFX_PER_BLOCK));
	emit(`     ⛏️  Mining ${blocksNeeded} blocks for block rewards…`);
	for (let mined = 0; mined < blocksNeeded; mined += FUNDING_MINE_BATCH) {
		const batch = Math.min(FUNDING_MINE_BATCH, blocksNeeded - mined);
		try {
			await context.localManager.mine(batch);
		} catch {
			// non-critical — mine may partially succeed
		}
	}
	fundingLines.push(`     ⛏️  Mined ${blocksNeeded} blocks for block rewards`);
	emit(`     ⛏️  Mined ${blocksNeeded} blocks`);

	// Phase 2: Bridge from Core to eSpace in chunks with exponential fallback
	let remainingWei = deficitWei;
	const maxIterations =
		Math.ceil(Number(remainingWei) / 1e18 / FUNDING_BRIDGE_CHUNK) + 10;
	emit(
		`     💸 Bridging ${(Number(deficitWei) / 1e18).toFixed(1)} CFX to eSpace…`,
	);

	for (
		let iteration = 0;
		iteration < maxIterations && remainingWei > 0n;
		iteration++
	) {
		const wantedCfx = Math.max(
			1,
			Math.min(FUNDING_BRIDGE_CHUNK, Math.ceil(Number(remainingWei) / 1e18)),
		);
		let funded = false;

		for (const amount of [
			wantedCfx,
			Math.ceil(wantedCfx / 2),
			Math.ceil(wantedCfx / 4),
			100,
			25,
			1,
		]) {
			if (amount < 1) continue;
			try {
				await context.localManager.fundEvmAccount(
					context.deployer,
					String(amount),
				);
				await context.localManager.packMine();
				const sentWei = BigInt(amount) * 10n ** 18n;
				remainingWei = remainingWei > sentWei ? remainingWei - sentWei : 0n;
				fundingLines.push(`     💸 Bridged ${amount} CFX`);
				emit(
					`     💸 Bridged ${amount} CFX (${(Number(remainingWei) / 1e18).toFixed(0)} remaining)`,
				);
				funded = true;
				break;
			} catch {
				// try smaller chunk
			}
		}

		if (!funded) break;
	}

	// Phase 3: Verify final balance
	const finalBalance = await wallet.getBalanceWei(context.deployer);
	if (finalBalance < requiredWei) {
		throw new Error(
			`${label}: still short ${(Number(requiredWei - finalBalance) / 1e18).toFixed(1)} CFX after staged funding`,
		);
	}
}

async function verifyDeployment(
	manifest: DexManifest,
): Promise<{ ok: boolean; pairCount: number; error?: string }> {
	try {
		const chain = defineChain({
			id: manifest.chainId,
			name: "Conflux eSpace",
			nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
			rpcUrls: { default: { http: [manifest.rpcUrl] } },
		});
		const client = createPublicClient({
			chain,
			transport: http(manifest.rpcUrl, { timeout: 30_000 }),
		});
		const pairCount = (await client.readContract({
			address: manifest.contracts.factory as `0x${string}`,
			abi: UniswapV2Factory.abi as never,
			functionName: "allPairsLength",
			args: [],
		})) as bigint;
		return { ok: true, pairCount: Number(pairCount) };
	} catch (error) {
		return { ok: false, pairCount: 0, error: String(error) };
	}
}

async function postManifest(manifest: DexManifest): Promise<void> {
	cachedManifest = manifest;
	await mirrorToDexUi("/api/dex/manifest", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(manifest),
	});
}

async function postTranslationTable(table: TranslationTable): Promise<void> {
	cachedTranslationTable = table;
	await mirrorToDexUi("/api/dex/translation-table", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(table),
	});
}

async function readManifest(
	rpcUrl: string,
	chainId: number,
): Promise<DexManifest | null> {
	if (cachedManifest) {
		const verify = await verifyDeployment(cachedManifest).catch(() => ({
			ok: false,
			pairCount: 0,
		}));
		if (verify.ok) return cachedManifest;
		cachedManifest = null;
	}

	const reconstructed = buildManifestFromTrackedContracts(
		readTrackedDexContracts(chainId),
		rpcUrl,
		chainId,
	);
	if (!reconstructed) return null;
	const verify = await verifyDeployment(reconstructed).catch(() => ({
		ok: false,
		pairCount: 0,
	}));
	if (!verify.ok) return null;
	cachedManifest = reconstructed;
	return reconstructed;
}

async function readTranslationTable(
	localWETH: string | undefined,
	chainId: number,
	rpcUrl: string,
): Promise<TranslationTable | null> {
	const manifest = await readManifest(rpcUrl, chainId);
	const resolvedWeth = localWETH ?? manifest?.contracts.weth9;
	if (!resolvedWeth) {
		cachedTranslationTable = null;
		return null;
	}
	if (
		cachedTranslationTable &&
		cachedTranslationTable.chainId === chainId &&
		cachedTranslationTable.localWETH.toLowerCase() ===
			resolvedWeth.toLowerCase()
	) {
		return cachedTranslationTable;
	}
	cachedTranslationTable = null;
	const reconstructed = buildTranslationTableFromTrackedContracts(
		readTrackedDexContracts(chainId),
		resolvedWeth,
		chainId,
	);
	if (!reconstructed) return null;
	cachedTranslationTable = reconstructed;
	return reconstructed;
}

async function deployDex(
	args: Record<string, unknown>,
	nodeManager: NodeManager,
	emit: ProgressEmitter = noopEmitter,
): Promise<string> {
	const accountIndex =
		typeof args.accountIndex === "number" ? args.accountIndex : 0;
	const context = await createDexWalletContext(nodeManager, accountIndex);
	const existing = await readManifest(context.rpcUrl, context.chainId);
	if (existing) {
		const msg = [
			"⚠️  V2 DEX already deployed - skipping.",
			"",
			`Factory:  ${existing.contracts.factory}`,
			`WETH9:    ${existing.contracts.weth9}`,
			`Router02: ${existing.contracts.router02}`,
		].join("\n");
		emit(msg);
		return msg;
	}

	const wallet = new DexWallet(context);
	emit("Deploying UniswapV2Factory…");
	const factoryAddress = await wallet.deployContract(
		UniswapV2Factory.abi,
		UniswapV2Factory.bytecode,
		[context.deployer],
	);
	emit(`  ✅ Factory: ${factoryAddress}`);

	emit("Deploying WETH9…");
	const weth9Address = await wallet.deployContract(
		wrappedCfxAbi,
		wrappedCfxBytecode,
		[],
	);
	emit(`  ✅ WETH9: ${weth9Address}`);

	emit("Deploying UniswapV2Router02…");
	const routerAddress = await wallet.deployContract(
		UniswapV2Router02.abi,
		UniswapV2Router02.bytecode,
		[factoryAddress, weth9Address],
	);
	emit(`  ✅ Router02: ${routerAddress}`);

	saveDexContract({
		name: `UniswapV2Factory${REGISTRY_SUFFIX}`,
		address: factoryAddress,
		chainId: context.chainId,
		deployer: context.deployer,
		abi: UniswapV2Factory.abi,
		metadata: { initCodeHash: _init_code_hash.computed },
	});
	saveDexContract({
		name: `WETH9${REGISTRY_SUFFIX}`,
		address: weth9Address,
		chainId: context.chainId,
		deployer: context.deployer,
		abi: wrappedCfxAbi,
	});
	saveDexContract({
		name: `UniswapV2Router02${REGISTRY_SUFFIX}`,
		address: routerAddress,
		chainId: context.chainId,
		deployer: context.deployer,
		abi: UniswapV2Router02.abi,
	});

	const manifest: DexManifest = {
		deployedAt: new Date().toISOString(),
		chainId: context.chainId,
		rpcUrl: context.rpcUrl,
		deployer: context.deployer,
		contracts: {
			factory: factoryAddress,
			weth9: weth9Address,
			router02: routerAddress,
		},
		initCodeHash: _init_code_hash.computed,
	};
	emit("Saving manifest and verifying deployment…");
	await postManifest(manifest);

	const verify = await verifyDeployment(manifest);
	const result = [
		"✅  Uniswap V2 stack deployed to eSpace",
		"",
		`Factory:        ${factoryAddress}`,
		`WETH9:          ${weth9Address}`,
		`Router02:       ${routerAddress}`,
		`Deployer:       ${context.deployer}`,
		`Chain ID:       ${context.chainId}`,
		`Init Code Hash: ${manifest.initCodeHash}`,
		"",
		`Factory allPairsLength() = ${verify.ok ? verify.pairCount : `RPC error - ${verify.error}`}`,
	].join("\n");
	emit(result);
	return result;
}

async function getDexStatus(nodeManager: NodeManager): Promise<string> {
	const context = await createDexWalletContext(nodeManager, 0);
	const manifest = await readManifest(context.rpcUrl, context.chainId);
	if (!manifest) {
		return [
			"V2 DEX: not deployed",
			"",
			"No DEX manifest found. Run dex_deploy to deploy the V2 stack.",
		].join("\n");
	}

	const verify = await verifyDeployment(manifest);
	const stableEntries = Object.values(manifest.stables ?? {});
	const stableLines =
		stableEntries.length > 0
			? [
					"",
					"Stablecoins:",
					...stableEntries.map(
						(stable) =>
							`  ${stable.symbol.padEnd(6)} ${stable.address}  (${stable.decimals} dec)`,
					),
				]
			: [];

	return [
		"V2 DEX: deployed ✓",
		`Deployed At:  ${manifest.deployedAt}`,
		`Deployer:     ${manifest.deployer}`,
		`Chain ID:     ${manifest.chainId}`,
		"",
		"Contracts:",
		`  Factory:    ${manifest.contracts.factory}`,
		`  WETH9:      ${manifest.contracts.weth9}`,
		`  Router02:   ${manifest.contracts.router02}`,
		"",
		`Init Code Hash: ${manifest.initCodeHash}`,
		"",
		`On-chain pairs: ${verify.ok ? verify.pairCount : `RPC error - ${verify.error}`}`,
		...stableLines,
	].join("\n");
}

async function seedDex(
	args: Record<string, unknown>,
	nodeManager: NodeManager,
	emit: ProgressEmitter = noopEmitter,
): Promise<string> {
	const accountIndex =
		typeof args.accountIndex === "number" ? args.accountIndex : 0;
	const forceRefresh = args.forceRefresh === true;
	const selectedStablecoins = Array.isArray(args.selectedStablecoins)
		? args.selectedStablecoins.filter(
				(value): value is string => typeof value === "string",
			)
		: undefined;

	const context = await createDexWalletContext(nodeManager, accountIndex);
	const manifest = await readManifest(context.rpcUrl, context.chainId);
	if (!manifest) {
		throw new NotFoundError("DEX manifest not found. Run dex_deploy first.");
	}

	// ── Resolve pools & feed: catalog-first, GeckoTerminal as fallback ───
	//
	// The known-tokens.json catalog has all pool data pre-cached.
	// Using it avoids all GeckoTerminal calls (no 429 risk, instant).
	// Only falls back to live API if a selected pool isn't in the catalog.

	const requestedPools = Array.isArray(args.selectedPoolAddresses)
		? args.selectedPoolAddresses.filter(
				(v: unknown): v is string =>
					typeof v === "string" && (v as string).length > 0,
			)
		: [];

	let feed: FeedCache;
	let sourcePoolCount = 0;
	let sourcePoolLabels: string[] = [];
	let resolveWarnings: string[] = [];
	const catalogResult =
		requestedPools.length > 0 ? resolvePoolsFromCatalog(requestedPools) : null;

	if (catalogResult) {
		// All pools resolved from catalog — zero network calls
		feed = catalogResult.feed;
		sourcePoolCount = requestedPools.length;
		sourcePoolLabels = feed.tokens.map((t) => t.symbol);
		emit(
			`Resolved ${feed.tokens.length} tokens from local catalog (no network calls)`,
		);
	} else {
		// Fallback: resolve via GeckoTerminal (slower, may 429)
		emit("Resolving pools via GeckoTerminal…");
		const { tokenSelections, selectedPools, warnings } =
			await resolveSelectedPoolInputs(args.selectedPoolAddresses);
		if (tokenSelections.length === 0) {
			throw new ValidationError(
				"No importable WCFX source pools were selected.",
			);
		}
		sourcePoolCount = selectedPools.length;
		sourcePoolLabels = selectedPools.map((p) => `${p.label} ${p.address}`);
		resolveWarnings = warnings;
		emit(`Fetching feed data for ${tokenSelections.length} token(s)…`);
		feed = await refreshSelectedTokenSourcesCache(
			MAINNET_CHAIN_ID,
			tokenSelections,
			{ skipStables: true, historyHours: 1, includeIcons: false },
			forceRefresh ? 0 : 30 * 60 * 1000,
		);
	}

	if (feed.tokens.length === 0) {
		throw new ValidationError(
			"No tokens resolved from pool selection. Check your pool addresses.",
		);
	}

	const wcfxPriceUsd =
		feed.wcfxPriceUsd && feed.wcfxPriceUsd > 0
			? feed.wcfxPriceUsd
			: (await fetchWcfxPriceFromProviders()).usd;

	emit(`WCFX price: $${wcfxPriceUsd.toPrecision(4)}`);
	emit(
		`Seeding ${feed.tokens.length} token(s) + ${selectedStablecoins?.length ?? STABLECOIN_DEFS.length} stablecoin(s)…`,
	);
	emit("");

	const wallet = new DexWallet(context);
	const fundingLines: string[] = [];
	const trackedContracts = readTrackedDexContracts(context.chainId);
	const mirrorTable = new TokenMirror({
		chainId: manifest.chainId,
		localWETH: manifest.contracts.weth9,
		initialTable:
			(await readTranslationTable(
				manifest.contracts.weth9,
				manifest.chainId,
				manifest.rpcUrl,
			)) ?? undefined,
	});

	const lines: string[] = [];
	let seededCount = 0;
	let skippedCount = 0;

	for (const token of feed.tokens) {
		const realAddress = token.realAddress.toLowerCase();
		let localAddress = mirrorTable.getLocalAddress(realAddress);
		const tokenIndex = feed.tokens.indexOf(token) + 1;
		emit(`[${tokenIndex}/${feed.tokens.length}] Seeding ${token.symbol}…`);
		try {
			if (localAddress) {
				const valid = await hasEvmContractCode(
					context.rpcUrl,
					manifest.chainId,
					localAddress,
				);
				if (!valid) {
					localAddress = undefined;
				}
			}
			if (!localAddress) {
				localAddress = await wallet.deployContract(
					MirrorERC20.abi,
					MirrorERC20.bytecode,
					[token.name + DEVKIT_NAME_SUFFIX, token.symbol, token.decimals],
				);
				mirrorTable.recordMirror(
					token as Parameters<TokenMirror["recordMirror"]>[0],
					localAddress,
				);
				saveDexContract({
					name: `${token.symbol}${REGISTRY_SUFFIX}`,
					address: localAddress,
					chainId: manifest.chainId,
					deployer: context.deployer,
					abi: MirrorERC20.abi,
					metadata: {
						realAddress: token.realAddress,
						symbol: token.symbol,
						decimals: token.decimals,
					},
				});
				lines.push(
					`  🪞 Mirrored  ${token.symbol.padEnd(10)} -> ${localAddress}`,
				);
				emit(`  🪞 Mirrored  ${token.symbol} -> ${localAddress}`);
			} else {
				mirrorTable.recordMirror(
					token as Parameters<TokenMirror["recordMirror"]>[0],
					localAddress,
				);
				lines.push(
					`  ♻️  Reusing   ${token.symbol.padEnd(10)} -> ${localAddress}`,
				);
				emit(`  ♻️  Reusing   ${token.symbol} -> ${localAddress}`);
			}

			const scale = autoScaleFactor(token.priceUsd, wcfxPriceUsd);
			const reserves = computeInitialReserves(
				token as Parameters<typeof computeInitialReserves>[0],
				wcfxPriceUsd,
				scale,
			);
			await ensureFunding(
				wallet,
				context,
				reserves.reserve1 + TOKEN_PAIR_GAS_BUFFER_WEI,
				`${token.symbol}/WCFX pool`,
				fundingLines,
				emit,
			);
			// Mint 2× reserve0: pool receives reserve0, deployer keeps the other half as a working balance.
			emit(`  Minting & approving ${token.symbol}…`);
			await wallet.writeAndWait(
				localAddress as `0x${string}`,
				MirrorERC20.abi,
				"mint",
				[context.deployer, reserves.reserve0 * 2n],
			);
			await wallet.writeAndWait(
				localAddress as `0x${string}`,
				MirrorERC20.abi,
				"approve",
				[manifest.contracts.router02, reserves.reserve0],
			);
			emit(`  Adding liquidity for ${token.symbol}/WCFX…`);
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
			await wallet.writeAndWait(
				manifest.contracts.router02 as `0x${string}`,
				UniswapV2Router02.abi,
				"addLiquidityETH",
				[localAddress, reserves.reserve0, 0n, 0n, context.deployer, deadline],
				reserves.reserve1,
			);
			const price = reservesToPrice(
				reserves.reserve0,
				reserves.reserve1,
				token.decimals,
			);
			lines.push(
				`     reserve0=${reserves.reserve0} (${token.symbol})  reserve1=${reserves.reserve1} (WCFX)  price=${price.toPrecision(4)} WCFX/${token.symbol}`,
			);
			seededCount += 1;
			emit(
				`  ✅ ${token.symbol} seeded (price=${price.toPrecision(4)} WCFX/${token.symbol})`,
			);
		} catch (error) {
			skippedCount += 1;
			lines.push(`  ❌  ${token.symbol}: ${String(error).split("\n")[0]}`);
			emit(`  ❌ ${token.symbol}: ${String(error).split("\n")[0]}`);
		}
	}

	const stableFilter = selectedStablecoins?.length
		? new Set(selectedStablecoins.map((symbol) => symbol.toUpperCase()))
		: null;
	const stableDefs = stableFilter
		? STABLECOIN_DEFS.filter((definition) =>
				stableFilter.has(definition.symbol.toUpperCase()),
			)
		: STABLECOIN_DEFS;
	const stableLines: string[] = [];
	const stables: Record<string, StableEntry> = {};

	for (const definition of stableDefs) {
		const stableIndex = stableDefs.indexOf(definition) + 1;
		emit(
			`[Stable ${stableIndex}/${stableDefs.length}] Seeding ${definition.symbol}…`,
		);
		try {
			const existing =
				findTrackedContractByRealAddress(
					trackedContracts,
					definition.realAddress,
				) ??
				findTrackedContractByName(
					trackedContracts,
					`${definition.symbol}${REGISTRY_SUFFIX}`,
				);
			const reusableExisting =
				existing &&
				(await hasEvmContractCode(
					context.rpcUrl,
					manifest.chainId,
					existing.address,
				))
					? existing
					: null;
			if (existing && !reusableExisting) {
				contractStorage.delete(existing.id);
			}
			const address =
				reusableExisting?.address ??
				(await wallet.deployContract(MirrorERC20.abi, MirrorERC20.bytecode, [
					definition.name + DEVKIT_NAME_SUFFIX,
					definition.symbol,
					definition.decimals,
				]));
			if (!reusableExisting) {
				saveDexContract({
					name: `${definition.symbol}${REGISTRY_SUFFIX}`,
					address,
					chainId: manifest.chainId,
					deployer: context.deployer,
					abi: MirrorERC20.abi,
					metadata: {
						realAddress: definition.realAddress,
						symbol: definition.symbol,
						decimals: definition.decimals,
					},
				});
			}

			const halfUsd = (100_000 * 0.01) / 2;
			const tokenAmount = BigInt(
				Math.floor((halfUsd / definition.priceUsd) * 10 ** definition.decimals),
			);
			const wcfxAmount = BigInt(Math.floor((halfUsd / wcfxPriceUsd) * 1e18));
			await ensureFunding(
				wallet,
				context,
				wcfxAmount + STABLE_PAIR_GAS_BUFFER_WEI,
				`${definition.symbol}/WCFX pool`,
				fundingLines,
				emit,
			);
			emit(`  Minting & approving ${definition.symbol}…`);
			// Always mint the full mintAmount so the deployer retains a generous balance after pool seeding.
			// The pool receives tokenAmount; the remainder (mintAmount − tokenAmount) stays with the deployer.
			await wallet.writeAndWait(
				address as `0x${string}`,
				MirrorERC20.abi,
				"mint",
				[context.deployer, definition.mintAmount],
			);
			await wallet.writeAndWait(
				address as `0x${string}`,
				MirrorERC20.abi,
				"approve",
				[manifest.contracts.router02, tokenAmount],
			);
			const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
			emit(`  Adding liquidity for ${definition.symbol}/WCFX…`);
			await wallet.writeAndWait(
				manifest.contracts.router02 as `0x${string}`,
				UniswapV2Router02.abi,
				"addLiquidityETH",
				[address, tokenAmount, 0n, 0n, context.deployer, deadline],
				wcfxAmount,
			);
			stables[definition.symbol] = {
				symbol: definition.symbol,
				name: definition.name + DEVKIT_NAME_SUFFIX,
				decimals: definition.decimals,
				address,
			};
			mirrorTable.recordMirror(
				{
					realAddress: definition.realAddress,
					symbol: definition.symbol,
					decimals: definition.decimals,
					iconCached: false,
				},
				address,
			);
			stableLines.push(`  💲 ${definition.symbol.padEnd(6)} -> ${address}`);
			emit(`  💲 ${definition.symbol} -> ${address}`);
		} catch (error) {
			stableLines.push(
				`  ❌ ${definition.symbol}: ${String(error).split("\n")[0]}`,
			);
			emit(`  ❌ ${definition.symbol}: ${String(error).split("\n")[0]}`);
		}
	}

	manifest.stables = stables;
	manifest.wcfxPriceUsd = wcfxPriceUsd;
	await postManifest(manifest);
	await postTranslationTable(
		mirrorTable.getTranslationTable() as TranslationTable,
	);

	const factoryContract = findTrackedContractByName(
		readTrackedDexContracts(manifest.chainId),
		`UniswapV2Factory${REGISTRY_SUFFIX}`,
	);
	if (factoryContract) {
		contractStorage.add({
			...factoryContract,
			metadata: {
				...(factoryContract.metadata ?? {}),
				initCodeHash: manifest.initCodeHash,
				stables,
				wcfxPriceUsd,
			},
		});
	}

	const verify = await verifyDeployment(manifest);
	emit("✅ Seeding complete — verifying on-chain pairs…");
	return [
		"✅  dex_seed_from_gecko complete",
		`    WCFX price used:  $${wcfxPriceUsd.toPrecision(4)}`,
		`    Source pools:     ${sourcePoolCount}`,
		`    Tokens from feed: ${feed.tokens.length}`,
		`    Seeded:           ${seededCount}`,
		`    Skipped (error):  ${skippedCount}`,
		`    Stablecoins:      ${stableDefs.length} (${stableDefs.map((definition) => definition.symbol).join(", ")})`,
		`    On-chain pairs:   ${verify.ok ? verify.pairCount : "RPC error"}`,
		"",
		...sourcePoolLabels.map((label) => `  📥 Source pool ${label}`),
		...(resolveWarnings.length
			? ["", ...resolveWarnings.map((warning) => `  ⚠  ${warning}`)]
			: []),
		...(fundingLines.length ? ["", ...fundingLines] : []),
		"",
		...lines,
		...(stableLines.length ? ["", "Stablecoins:", ...stableLines] : []),
		"",
		"Translation table saved to DEX service.",
		"Run dex_status to confirm pair count.",
	].join("\n");
}

export function createDexRuntimeRoutes(nodeManager: NodeManager): Router {
	const router = Router();

	router.get(
		"/source-pools/suggestions",
		asyncHandler(async (req, res) => {
			const limit =
				typeof req.query.limit === "string"
					? Number(req.query.limit)
					: DEFAULT_POOL_SUGGESTION_LIMIT;
			const suggestions = await listSuggestedSourcePools(
				Number.isFinite(limit) && limit > 0
					? limit
					: DEFAULT_POOL_SUGGESTION_LIMIT,
			);
			res.json({ suggestions });
		}),
	);

	/**
	 * POST /api/dex/source-pools/prefetch
	 * Warm the feed cache without deploying the DEX.
	 * Accepts { selectedPoolAddresses?: string[] } — defaults to top suggestions.
	 * Returns the FeedCache written to disk.
	 */
	router.post(
		"/source-pools/prefetch",
		asyncHandler(async (req, res) => {
			const body = req.body as {
				selectedPoolAddresses?: unknown;
				forceRefresh?: unknown;
			};
			const forceRefresh = body.forceRefresh === true;
			const { tokenSelections } = await resolveSelectedPoolInputs(
				body.selectedPoolAddresses,
			);
			if (tokenSelections.length === 0) {
				res.json({
					ok: true,
					tokens: 0,
					message: "No importable WCFX pools found — skipping prefetch.",
				});
				return;
			}
			const feed = await refreshSelectedTokenSourcesCache(
				MAINNET_CHAIN_ID,
				tokenSelections,
				{ skipStables: true, historyHours: 1, includeIcons: false },
				forceRefresh ? 0 : 4 * 60 * 60 * 1000, // 4h cache validity
			);
			res.json({
				ok: true,
				tokens: feed.tokens.length,
				wcfxPriceUsd: feed.wcfxPriceUsd,
				fetchedAt: feed.fetchedAt,
			});
		}),
	);

	router.post(
		"/source-pools/refresh",
		asyncHandler(async (req, res) => {
			const body = req.body as Partial<SeedRefreshRequest>;
			const chainId = Number(body.chainId ?? 0);
			const tokenSelections = Array.isArray(body.tokenSelections)
				? body.tokenSelections
				: [];
			const forceRefresh = body.forceRefresh === true;
			const maxAgeMs =
				typeof body.maxAgeMs === "number" && body.maxAgeMs >= 0
					? body.maxAgeMs
					: 30 * 60 * 1000;

			if (!Number.isFinite(chainId) || chainId <= 0) {
				throw new ValidationError("chainId must be a positive number");
			}
			if (tokenSelections.length === 0) {
				throw new ValidationError(
					"tokenSelections must contain at least one selection",
				);
			}

			const feed = await refreshSelectedTokenSourcesCache(
				chainId,
				tokenSelections,
				{
					skipStables: true,
					historyHours: 1,
					includeIcons: false,
				},
				forceRefresh ? 0 : maxAgeMs,
			);
			res.json(feed satisfies FeedCache);
		}),
	);

	router.get(
		"/pricing/wcfx-usd",
		asyncHandler(async (_req, res) => {
			const price = await fetchWcfxPriceFromProviders();
			res.json(price);
		}),
	);

	router.get("/manifest", (_req, res) => {
		if (!cachedManifest) throw new NotFoundError("dex manifest not found");
		res.json(cachedManifest);
	});

	router.post(
		"/manifest",
		asyncHandler(async (req, res) => {
			cachedManifest = req.body as DexManifest;
			await mirrorToDexUi("/api/dex/manifest", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(cachedManifest),
			});
			res.json({ ok: true });
		}),
	);

	router.get("/translation-table", (_req, res) => {
		if (!cachedTranslationTable)
			throw new NotFoundError("dex translation table not found");
		res.json(cachedTranslationTable);
	});

	router.post(
		"/translation-table",
		asyncHandler(async (req, res) => {
			cachedTranslationTable = req.body as TranslationTable;
			await mirrorToDexUi("/api/dex/translation-table", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(cachedTranslationTable),
			});
			res.json({ ok: true });
		}),
	);

	router.delete(
		"/state",
		asyncHandler(async (_req, res) => {
			let removed = 0;
			try {
				const context = await createDexWalletContext(nodeManager, 0);
				removed = clearTrackedDexContracts(context.chainId);
			} catch {
				removed = clearTrackedDexContracts();
			}
			await clearDexRuntimeState();
			res.json({ ok: true, removedContracts: removed });
		}),
	);

	router.get(
		"/status",
		asyncHandler(async (_req, res) => {
			const text = await getDexStatus(nodeManager);
			res.json({ ok: true, text });
		}),
	);

	router.post(
		"/deploy",
		asyncHandler(async (req, res) => {
			const text = await deployDex(
				req.body as Record<string, unknown>,
				nodeManager,
			);
			res.json({ ok: true, text });
		}),
	);

	router.post(
		"/seed",
		asyncHandler(async (req, res) => {
			const text = await seedDex(
				req.body as Record<string, unknown>,
				nodeManager,
			);
			res.json({ ok: true, text });
		}),
	);

	// ── SSE streaming endpoints ─────────────────────────────────────────
	// These send real-time progress lines as Server-Sent Events,
	// then a final JSON payload with the complete result.

	router.post("/deploy-stream", async (req, res) => {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		// compression middleware adds flush(); call it after every write to avoid buffering
		const flushRes = () => (res as unknown as { flush?: () => void }).flush?.();

		const emit: ProgressEmitter = (line) => {
			if (!res.writableEnded) {
				res.write(`data: ${JSON.stringify({ type: "progress", line })}\n\n`);
				flushRes();
			}
		};

		try {
			const text = await deployDex(
				req.body as Record<string, unknown>,
				nodeManager,
				emit,
			);
			if (!res.writableEnded) {
				res.write(`data: ${JSON.stringify({ type: "done", text })}\n\n`);
				flushRes();
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!res.writableEnded) {
				res.write(
					`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`,
				);
				flushRes();
			}
		}
		res.end();
	});

	router.post("/seed-stream", async (req, res) => {
		res.setHeader("Content-Type", "text/event-stream");
		res.setHeader("Cache-Control", "no-cache");
		res.setHeader("Connection", "keep-alive");
		res.flushHeaders();

		// compression middleware adds flush(); call it after every write to avoid buffering
		const flushRes = () => (res as unknown as { flush?: () => void }).flush?.();

		const emit: ProgressEmitter = (line) => {
			if (!res.writableEnded) {
				res.write(`data: ${JSON.stringify({ type: "progress", line })}\n\n`);
				flushRes();
			}
		};

		try {
			const text = await seedDex(
				req.body as Record<string, unknown>,
				nodeManager,
				emit,
			);
			if (!res.writableEnded) {
				res.write(`data: ${JSON.stringify({ type: "done", text })}\n\n`);
				flushRes();
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!res.writableEnded) {
				res.write(
					`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`,
				);
				flushRes();
			}
		}
		res.end();
	});

	return router;
}
