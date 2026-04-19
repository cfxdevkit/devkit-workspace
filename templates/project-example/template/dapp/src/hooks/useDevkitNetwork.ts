import { useEffect, useState } from "react";
import { useAccount, useChainId, useSwitchChain } from "wagmi";
import { appUrl, isLocalRuntime } from "../app-base";
import { isSupportedChainId, resolveRuntimeDefaultChainId } from "../chains";
import { PROJECT_DEFAULT_CHAIN_ID } from "../generated/project-network";

interface DevkitNetworkStatus {
	evmChainId: number;
}

/**
 * Resolves the project target chain. The dev/prod start scripts bake the selected
 * network into `project-network.ts`, and in dev we also reconcile that with the
 * live DevKit backend when it is reachable.
 */
export function useDevkitNetworkSync() {
	const { isConnected } = useAccount();
	const walletChainId = useChainId();
	const { switchChain } = useSwitchChain();
	const runtimeDefaultChainId = resolveRuntimeDefaultChainId(
		PROJECT_DEFAULT_CHAIN_ID,
	);
	const [targetChainId, setTargetChainId] = useState(runtimeDefaultChainId);

	useEffect(() => {
		let cancelled = false;

		if (!isLocalRuntime()) {
			setTargetChainId(runtimeDefaultChainId);
			return () => {
				cancelled = true;
			};
		}

		async function sync() {
			try {
				const res = await fetch(appUrl("devkit/api/network/current"), {
					signal: AbortSignal.timeout(4_000),
				});
				if (!res.ok || cancelled) return;
				const data = (await res.json()) as DevkitNetworkStatus;
				const nextChainId = data?.evmChainId;
				if (
					typeof nextChainId === "number" &&
					isSupportedChainId(nextChainId)
				) {
					setTargetChainId(nextChainId);
				}
			} catch {
				if (cancelled) return;
				setTargetChainId(runtimeDefaultChainId);
			}
		}

		void sync();
		return () => {
			cancelled = true;
		};
	}, [runtimeDefaultChainId]);

	const activeChainId = isConnected ? walletChainId : targetChainId;
	const isWrongChain = isConnected && walletChainId !== targetChainId;

	return {
		activeChainId,
		isWrongChain,
		switchToTargetChain() {
			if (!isConnected || walletChainId === targetChainId) return;
			switchChain?.({ chainId: targetChainId });
		},
		targetChainId,
	};
}
