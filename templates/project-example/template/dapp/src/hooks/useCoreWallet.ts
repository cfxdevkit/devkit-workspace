/**
 * Dapp-local re-export of @devkit/conflux-wallet.
 *
 * Wires the local devkit RPC URL (appAbsoluteUrl) into
 * getCoreChainConfigForEspaceChain so the rest of the app doesn't
 * need to import app-base directly.
 */
export {
	CORE_CHAIN_CONFIGS,
	type CoreChainConfig,
	type CoreSnapshot,
	createCoreChain,
	createCorePublicClient,
	createCoreWalletClient,
	getCoreChainLabel,
	normalizeCoreAddressForChain,
	readCoreSnapshot,
	useCoreWallet,
} from "@devkit/conflux-wallet";

import { getCoreChainConfigForEspaceChain as _getCoreChainConfigForEspaceChain } from "@devkit/conflux-wallet";
import { appAbsoluteUrl, isLocalRuntime } from "../app-base";

export function getCoreChainConfigForEspaceChain(espaceChainId: number) {
	return _getCoreChainConfigForEspaceChain(
		espaceChainId,
		espaceChainId === 2030 && isLocalRuntime()
			? appAbsoluteUrl("core-rpc")
			: undefined,
	);
}
