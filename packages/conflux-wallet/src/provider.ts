/**
 * Low-level window.conflux provider primitives for Fluent wallet.
 *
 * All functions are pure async utilities with no React dependency.
 * They use the Conflux-native RPC methods:
 *   cfx_chainId, cfx_accounts, cfx_requestAccounts
 *   wallet_switchConfluxChain, wallet_addConfluxChain
 */

export interface FluentProvider {
	isFluent?: boolean;
	request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
	on: (event: string, handler: (...args: unknown[]) => void) => void;
	removeListener: (
		event: string,
		handler: (...args: unknown[]) => void,
	) => void;
}

/** Normalize any chainId string (decimal or hex) to lowercase hex, e.g. "0x7ed". */
export function normalizeChainId(raw: string): string {
	if (!raw || raw === "0xNaN") return raw;
	const num = Number(raw);
	if (!Number.isNaN(num) && num > 0) return `0x${num.toString(16)}`;
	return raw.toLowerCase();
}

/** Read window.conflux if it belongs to Fluent. */
export function getFluentProvider(): FluentProvider | null {
	const w = window as unknown as { conflux?: FluentProvider };
	return w.conflux?.isFluent ? w.conflux : null;
}

/**
 * Detect window.conflux with exponential back-off.
 * Fluent injects asynchronously, so we retry for up to maxMs.
 */
export async function detectFluent(
	maxMs = 3_000,
): Promise<FluentProvider | null> {
	const deadline = Date.now() + maxMs;
	let delay = 50;
	while (Date.now() < deadline) {
		const p = getFluentProvider();
		if (p) return p;
		await new Promise<void>((r) => setTimeout(r, delay));
		delay = Math.min(delay * 2, 500);
	}
	return getFluentProvider();
}

/** Ask the wallet for the current chain ID; returns lowercase hex or null. */
export async function rpcChainId(p: FluentProvider): Promise<string | null> {
	try {
		const id = (await p.request({ method: "cfx_chainId" })) as string;
		if (!id || id === "0xNaN") return null;
		return normalizeChainId(id);
	} catch {
		return null;
	}
}

/** Ask the wallet for the current accounts list (no popup). */
export async function rpcAccounts(p: FluentProvider): Promise<string[]> {
	try {
		const result = (await p.request({ method: "cfx_accounts" })) as string[];
		return Array.isArray(result) ? result : [];
	} catch {
		return [];
	}
}

/** Request account access — triggers the Fluent authorize popup. */
export async function rpcRequestAccounts(p: FluentProvider): Promise<string[]> {
	const result = (await p.request({
		method: "cfx_requestAccounts",
	})) as string[];
	return Array.isArray(result) ? result : [];
}

/**
 * Try wallet_switchConfluxChain.
 * On code 4902 (chain not registered), adds it first via wallet_addConfluxChain then retries.
 * Throws on user rejection (code 4001) or if all rpcUrls fail to add.
 *
 * @param p        Fluent provider
 * @param chainId  Target chain ID hex (e.g. "0x7ed")
 * @param addParams  Parameters for wallet_addConfluxChain if chain is unknown
 */
export async function switchConfluxChain(
	p: FluentProvider,
	chainId: string,
	addParams: ConfluxAddChainParams,
): Promise<void> {
	try {
		await p.request({
			method: "wallet_switchConfluxChain",
			params: [{ chainId }],
		});
	} catch (switchErr) {
		const code = (switchErr as { code?: number })?.code;
		if (code === 4001) throw switchErr; // user rejected

		if (code === 4902 || code === -32603) {
			// Chain not registered — add it, then retry the switch.
			let added = false;
			for (const rpcUrl of addParams.rpcUrls) {
				try {
					await p.request({
						method: "wallet_addConfluxChain",
						params: [{ ...addParams, rpcUrls: [rpcUrl] }],
					});
					added = true;
					break;
				} catch (addErr) {
					if ((addErr as { code?: number })?.code === 4001) throw addErr;
					// else try next rpcUrl
				}
			}
			if (!added) throw switchErr;
			await p.request({
				method: "wallet_switchConfluxChain",
				params: [{ chainId }],
			});
		} else {
			throw switchErr;
		}
	}
}

export interface ConfluxAddChainParams {
	chainId: string;
	chainName: string;
	nativeCurrency: { name: string; symbol: string; decimals: number };
	rpcUrls: string[];
	blockExplorerUrls?: string[];
}

/**
 * Wait for a chainChanged event matching targetHex, with polling fallback.
 * Resolves true when matched, false on timeout.
 */
export function waitForChain(
	p: FluentProvider,
	targetHex: string,
	maxMs = 10_000,
	pollIntervalMs = 300,
): Promise<boolean> {
	const target = targetHex.toLowerCase();
	return new Promise<boolean>((resolve) => {
		let done = false;
		let pollTimer: ReturnType<typeof setTimeout>;

		const finish = (matched: boolean) => {
			if (done) return;
			done = true;
			clearTimeout(pollTimer);
			p.removeListener("chainChanged", onChainChanged);
			resolve(matched);
		};

		const onChainChanged = (chainId: unknown) => {
			if (typeof chainId !== "string") return;
			if (normalizeChainId(chainId) === target) finish(true);
		};

		p.on("chainChanged", onChainChanged);

		const poll = async () => {
			const id = await rpcChainId(p);
			if (id === target) {
				finish(true);
				return;
			}
			if (!done) pollTimer = setTimeout(poll, pollIntervalMs);
		};
		pollTimer = setTimeout(poll, pollIntervalMs);

		setTimeout(() => finish(false), maxMs);
	});
}

export function formatProviderError(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === "object" && err !== null) {
		const e = err as { message?: string };
		if (e.message) return e.message;
	}
	return String(err);
}
