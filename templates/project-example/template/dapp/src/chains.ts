import { defineChain } from "viem";
import { appUrl, isHostedRuntime } from "./app-base";
import { CONTRACT_ADDRESSES_BY_CHAIN_ID } from "./generated/contracts-addresses";

export const confluxLocalESpace = defineChain({
	id: 2030,
	name: "Conflux eSpace (Local)",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: {
		default: { http: [appUrl("rpc")] },
	},
});

export const confluxTestnetESpace = defineChain({
	id: 71,
	name: "Conflux eSpace (Testnet)",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://evmtestnet.confluxrpc.com"] },
	},
	blockExplorers: {
		default: {
			name: "ConfluxScan Testnet",
			url: "https://evmtestnet.confluxscan.org",
		},
	},
	testnet: true,
});

export const confluxMainnetESpace = defineChain({
	id: 1030,
	name: "Conflux eSpace",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: {
		default: { http: ["https://evm.confluxrpc.com"] },
	},
	blockExplorers: {
		default: { name: "ConfluxScan", url: "https://evm.confluxscan.org" },
	},
});

export const SUPPORTED_CHAINS = [
	confluxLocalESpace,
	confluxTestnetESpace,
	confluxMainnetESpace,
] as const;

export const PUBLIC_ESPACE_CHAINS = [
	confluxTestnetESpace,
	confluxMainnetESpace,
] as const;

export function resolveRuntimeDefaultChainId(projectDefaultChainId: number): number {
	if (!isHostedRuntime() || projectDefaultChainId !== confluxLocalESpace.id) {
		return projectDefaultChainId;
	}

	for (const chain of PUBLIC_ESPACE_CHAINS) {
		if (Object.keys(CONTRACT_ADDRESSES_BY_CHAIN_ID[chain.id] ?? {}).length > 0) {
			return chain.id;
		}
	}

	return confluxTestnetESpace.id;
}

export function getRuntimeEspaceChains(projectDefaultChainId: number) {
	const runtimeDefaultChainId = resolveRuntimeDefaultChainId(projectDefaultChainId);
	const baseChains = isHostedRuntime()
		? [...PUBLIC_ESPACE_CHAINS]
		: [...SUPPORTED_CHAINS];
	const preferredChain =
		baseChains.find((chain) => chain.id === runtimeDefaultChainId) ?? baseChains[0];

	return [
		preferredChain,
		...baseChains.filter((chain) => chain.id !== preferredChain.id),
	] as const;
}

export function isSupportedChainId(chainId: number): boolean {
	const supportedChains = isHostedRuntime()
		? PUBLIC_ESPACE_CHAINS
		: SUPPORTED_CHAINS;
	return supportedChains.some((c) => c.id === chainId);
}

export function getChainLabel(chainId: number): string {
	if (chainId === confluxLocalESpace.id) return "eSpace Local";
	if (chainId === confluxTestnetESpace.id) return "eSpace Testnet";
	if (chainId === confluxMainnetESpace.id) return "eSpace";
	return `Chain ${chainId}`;
}
