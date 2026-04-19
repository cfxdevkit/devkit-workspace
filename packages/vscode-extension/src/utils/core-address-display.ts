import {
	chainIdToPrefix,
	convertCoreAddressNetwork,
	encodeConfluxAddress,
} from "./conflux-address";

export function deriveCoreAddressForNetwork(params: {
	coreAddress?: string;
	evmAddress?: string;
	targetChainId: number;
}): string {
	const { coreAddress, evmAddress, targetChainId } = params;

	if (coreAddress) {
		try {
			return convertCoreAddressNetwork(coreAddress, targetChainId);
		} catch {
			// Fall through to the network-independent EVM address when the stored
			// Core address cannot be decoded or re-encoded.
		}
	}

	if (evmAddress) {
		try {
			return encodeConfluxAddress(evmAddress, chainIdToPrefix(targetChainId));
		} catch {
			// Fall through to the original values below.
		}
	}

	return coreAddress ?? evmAddress ?? "";
}
