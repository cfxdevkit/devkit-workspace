/**
 * useCoreWallet — React hook for Fluent wallet (Conflux Core Space).
 *
 * Drives window.conflux directly without @cfxjs/use-wallet-react.
 *
 * Connection flow:
 *   1. connect()     — authorize the dapp (shows Fluent popup, no chain switch)
 *   2. switchChain() — switch to the desired network (separate action)
 *
 * Chain IDs are always stored as lowercase hex (e.g. "0x7ed") to
 * match CoreChainConfig.chainIdHex directly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
	buildAddChainParams,
	type CoreChainConfig,
	createCorePublicClient,
	createCoreWalletClient,
} from "./chains.js";
import {
	detectFluent,
	type FluentProvider,
	formatProviderError,
	normalizeChainId,
	rpcAccounts,
	rpcChainId,
	rpcRequestAccounts,
	switchConfluxChain,
	waitForChain,
} from "./provider.js";

type WalletStatus =
	| "detecting"
	| "not-installed"
	| "not-active"
	| "connecting"
	| "active";

interface WalletState {
	status: WalletStatus;
	account: string | null;
	/** Normalized lowercase hex chain ID, e.g. "0x7ed". Null until known. */
	chainId: string | null;
}

export function useCoreWallet() {
	const [state, setState] = useState<WalletState>({
		status: "detecting",
		account: null,
		chainId: null,
	});
	const [error, setError] = useState<string | null>(null);
	const [isSwitching, setIsSwitching] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const providerRef = useRef<FluentProvider | null>(null);

	// Read both accounts and chainId in one pass, no popup.
	const syncState = useCallback(async (p: FluentProvider) => {
		const [chainId, accounts] = await Promise.all([
			rpcChainId(p),
			rpcAccounts(p),
		]);
		const account = accounts[0] ?? null;
		setState({ status: account ? "active" : "not-active", account, chainId });
	}, []);

	// -------------------------------------------------------------------------
	// Detection + event subscription
	// -------------------------------------------------------------------------
	useEffect(() => {
		let cancelled = false;

		const onAccountsChanged = (accounts: unknown) => {
			if (cancelled) return;
			const list = Array.isArray(accounts) ? (accounts as string[]) : [];
			const account = list[0] ?? null;
			setState((prev) => ({
				...prev,
				status: account ? "active" : "not-active",
				account,
			}));
		};

		const onChainChanged = (chainId: unknown) => {
			if (cancelled) return;
			if (typeof chainId !== "string" || !chainId || chainId === "0xNaN") {
				setState((prev) => ({ ...prev, chainId: null }));
				return;
			}
			setState((prev) => ({ ...prev, chainId: normalizeChainId(chainId) }));
		};

		detectFluent().then((p) => {
			if (cancelled) return;
			if (!p) {
				setState({ status: "not-installed", account: null, chainId: null });
				return;
			}
			providerRef.current = p;
			p.on("accountsChanged", onAccountsChanged);
			p.on("chainChanged", onChainChanged);
			syncState(p).catch(() => {
				if (!cancelled)
					setState({ status: "not-active", account: null, chainId: null });
			});
		});

		return () => {
			cancelled = true;
			const p = providerRef.current;
			if (p) {
				p.removeListener("accountsChanged", onAccountsChanged);
				p.removeListener("chainChanged", onChainChanged);
			}
		};
	}, [syncState]);

	// -------------------------------------------------------------------------
	// connect — authorize the dapp only, no chain switching.
	// Chain switching is done separately via switchChain().
	// -------------------------------------------------------------------------
	const connect = useCallback(async () => {
		const p = providerRef.current;
		if (!p || state.status !== "not-active") return;
		setError(null);
		setState((prev) => ({ ...prev, status: "connecting" }));
		try {
			const accounts = await rpcRequestAccounts(p);
			const account = accounts[0] ?? null;
			const chainId = await rpcChainId(p);
			setState({ status: account ? "active" : "not-active", account, chainId });
		} catch (err: unknown) {
			setState((prev) => ({ ...prev, status: "not-active" }));
			if ((err as { code?: number })?.code !== 4001) {
				setError(formatProviderError(err));
			}
		}
	}, [state.status]);

	// -------------------------------------------------------------------------
	// switchChain
	//  1. wallet_switchConfluxChain — no popup if chain is already registered.
	//  2. On 4902, add via wallet_addConfluxChain then retry the switch.
	//  3. Wait for the change via chainChanged event or polling fallback.
	// -------------------------------------------------------------------------
	const switchChain = useCallback(async (target: CoreChainConfig) => {
		const p = providerRef.current;
		if (!p) return;
		setIsSwitching(true);
		setError(null);
		try {
			await switchConfluxChain(
				p,
				target.chainIdHex,
				buildAddChainParams(target, target.rpcUrl),
			);
			await waitForChain(p, target.chainIdHex);
			// Force-read to ensure state is correct regardless of event timing.
			const chainId = await rpcChainId(p);
			setState((prev) => ({ ...prev, chainId }));
		} catch (err: unknown) {
			if ((err as { code?: number })?.code !== 4001) {
				setError(formatProviderError(err));
			}
		} finally {
			setIsSwitching(false);
		}
	}, []);

	// -------------------------------------------------------------------------
	// refresh — re-read all state from wallet without any popup
	// -------------------------------------------------------------------------
	const refresh = useCallback(async () => {
		const p = providerRef.current;
		if (!p) return;
		setIsRefreshing(true);
		try {
			await syncState(p);
		} catch {
			// ignore
		} finally {
			setIsRefreshing(false);
		}
	}, [syncState]);

	// -------------------------------------------------------------------------
	// disconnect — clears local state (Fluent has no programmatic revoke API)
	// -------------------------------------------------------------------------
	const disconnect = useCallback(() => {
		setState((prev) => ({
			...prev,
			status: "not-active",
			account: null,
		}));
		setError(null);
	}, []);

	const getWalletClient = useCallback((target: CoreChainConfig) => {
		const p = providerRef.current;
		if (!p) return null;
		return createCoreWalletClient(target, p);
	}, []);

	const getPublicClient = useCallback(
		(target: CoreChainConfig) => createCorePublicClient(target),
		[],
	);

	return {
		address: state.account,
		chainId: state.chainId,
		error,
		isAvailable:
			state.status !== "detecting" && state.status !== "not-installed",
		isConnecting: state.status === "connecting",
		isConnected: state.status === "active",
		isRefreshing,
		isSwitching,
		refresh,
		connect,
		disconnect,
		switchChain,
		getWalletClient,
		getPublicClient,
	};
}
