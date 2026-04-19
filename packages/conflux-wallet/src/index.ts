// Public API of @devkit/conflux-wallet

// Chain config types + helpers (no React)
export type { CoreChainConfig, CoreSnapshot } from "./chains.js";
export {
	buildAddChainParams,
	createCoreChain,
	createCorePublicClient,
	createCoreWalletClient,
	getCoreChainLabel,
	normalizeCoreAddressForChain,
	readCoreSnapshot,
} from "./chains.js";
// Known networks
export {
	CORE_CHAIN_CONFIGS,
	getCoreChainConfigForEspaceChain,
} from "./known-chains.js";
// Provider primitives (no React)
export type { ConfluxAddChainParams, FluentProvider } from "./provider.js";
export {
	detectFluent,
	formatProviderError,
	getFluentProvider,
	normalizeChainId,
	rpcAccounts,
	rpcChainId,
	rpcRequestAccounts,
	switchConfluxChain,
	waitForChain,
} from "./provider.js";

// React hook
export { useCoreWallet } from "./use-core-wallet.js";
