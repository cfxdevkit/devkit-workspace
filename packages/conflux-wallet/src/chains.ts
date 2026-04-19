/**
 * Core Space chain configuration and cive-based utilities.
 */
import {
	type Address as CiveAddress,
	createPublicClient,
	createWalletClient,
	custom,
	formatCFX,
	http,
} from "cive";
import {
	base32AddressToHex,
	defineChain,
	hexAddressToBase32,
} from "cive/utils";
import type { FluentProvider } from "./provider.js";

export interface CoreChainConfig {
	coreChainId: number;
	/** Lowercase hex, e.g. "0x7ed" */
	chainIdHex: string;
	label: string;
	rpcUrl: string;
	/** Ordered list of RPC URLs to try (first is preferred). */
	rpcUrls: string[];
	blockExplorerUrl?: string;
}

export interface CoreSnapshot {
	balanceCFX: string | null;
	blockHeight: string | null;
	epochNumber: string | null;
	chainId: string | null;
}

export function buildAddChainParams(target: CoreChainConfig, rpcUrl: string) {
	return {
		chainId: target.chainIdHex,
		chainName: `Conflux ${target.label}`,
		nativeCurrency: { name: "Conflux", symbol: "CFX", decimals: 18 },
		rpcUrls: [rpcUrl],
		...(target.blockExplorerUrl
			? { blockExplorerUrls: [target.blockExplorerUrl] }
			: {}),
	};
}

export function createCoreChain(config: CoreChainConfig) {
	return defineChain({
		id: config.coreChainId,
		name: config.label,
		nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
		rpcUrls: {
			default: { http: [config.rpcUrl] },
		},
		blockExplorers: config.blockExplorerUrl
			? { default: { name: "ConfluxScan", url: config.blockExplorerUrl } }
			: undefined,
	});
}

export function createCorePublicClient(config: CoreChainConfig) {
	return createPublicClient({
		chain: createCoreChain(config),
		transport: http(config.rpcUrl, { timeout: 10_000 }),
	});
}

export function createCoreWalletClient(
	config: CoreChainConfig,
	provider: FluentProvider,
) {
	return createWalletClient({
		chain: createCoreChain(config),
		transport: custom(provider as Parameters<typeof custom>[0]),
	});
}

/**
 * Convert a Conflux address to the base32 format expected by the given chainId.
 * Accepts both hex (0x…) and base32 (cfx:…) input.
 */
export function normalizeCoreAddressForChain(
	address: string | null | undefined,
	chainId: number,
): CiveAddress | null {
	if (!address) return null;
	try {
		const normalizedInput = address.trim();
		const hexAddress = normalizedInput.startsWith("0x")
			? (normalizedInput as `0x${string}`)
			: base32AddressToHex({ address: normalizedInput as CiveAddress });
		return hexAddressToBase32({
			hexAddress,
			networkId: chainId,
			verbose: false,
		}) as CiveAddress;
	} catch {
		return null;
	}
}

export async function readCoreSnapshot(
	config: CoreChainConfig,
	address?: string | null,
): Promise<CoreSnapshot> {
	const client = createCorePublicClient(config);
	const normalizedAddress = normalizeCoreAddressForChain(
		address,
		config.coreChainId,
	);

	const [status, block, balance] = await Promise.all([
		client.getStatus(),
		client.getBlock({ epochTag: "latest_state" }),
		normalizedAddress
			? client.getBalance({ address: normalizedAddress })
			: Promise.resolve(null),
	]);

	return {
		balanceCFX: typeof balance === "bigint" ? formatCFX(balance) : null,
		blockHeight: block?.height != null ? String(block.height) : null,
		epochNumber:
			status?.epochNumber != null ? String(status.epochNumber) : null,
		chainId: status?.chainId != null ? String(status.chainId) : null,
	};
}

export function getCoreChainLabel(chainId: string | null): string {
	switch (chainId?.toLowerCase()) {
		case "0x7ed":
			return "Conflux Core Local";
		case "0x1":
			return "Conflux Core Testnet";
		case "0x405":
			return "Conflux Core Mainnet";
		default:
			return chainId ?? "Unavailable";
	}
}
