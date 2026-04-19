/**
 * Built-in CoreChainConfig entries for the standard Conflux networks.
 * Apps can extend this map or pass custom configs directly.
 */
import type { CoreChainConfig } from "./chains.js";

export const CORE_CHAIN_CONFIGS: Record<number, CoreChainConfig> = {
	2029: {
		coreChainId: 2029,
		chainIdHex: "0x7ed",
		label: "Core Local",
		// rpcUrl is intentionally left as empty string here — callers that need
		// the local devkit URL should override it via getCoreChainConfigForEspaceChain
		// or supply their own config.
		rpcUrl: "",
		rpcUrls: ["http://127.0.0.1:12537", "http://localhost:12537"],
	},
	1: {
		coreChainId: 1,
		chainIdHex: "0x1",
		label: "Core Testnet",
		rpcUrl: "https://test.confluxrpc.com",
		rpcUrls: ["https://test.confluxrpc.com"],
		blockExplorerUrl: "https://testnet.confluxscan.org",
	},
	1029: {
		coreChainId: 1029,
		chainIdHex: "0x405",
		label: "Core Mainnet",
		rpcUrl: "https://main.confluxrpc.com",
		rpcUrls: ["https://main.confluxrpc.com"],
		blockExplorerUrl: "https://confluxscan.org",
	},
};

/**
 * Derive the Core chain config that pairs with a given eSpace chain ID.
 * @param espaceChainId  The EVM/eSpace chain ID (e.g. 2030, 71, 1030)
 * @param localRpcUrl    Override for the local devkit RPC URL (optional)
 */
export function getCoreChainConfigForEspaceChain(
	espaceChainId: number,
	localRpcUrl?: string,
): CoreChainConfig {
	const local: CoreChainConfig = {
		...CORE_CHAIN_CONFIGS[2029],
		rpcUrl: localRpcUrl ?? "http://127.0.0.1:12537",
		rpcUrls: localRpcUrl
			? [localRpcUrl, "http://127.0.0.1:12537", "http://localhost:12537"]
			: ["http://127.0.0.1:12537", "http://localhost:12537"],
	};
	if (espaceChainId === 2030) return local;
	if (espaceChainId === 71) return CORE_CHAIN_CONFIGS[1];
	if (espaceChainId === 1030) return CORE_CHAIN_CONFIGS[1029];
	return local;
}
