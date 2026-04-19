/**
 * views/accounts.ts
 *
 * TreeDataProvider for the "Conflux Accounts" sidebar view.
 *
 * eSpace addresses (0x…):
 *   - Loaded from the keystore file directly — works offline, no server needed.
 *   - The same address on every Conflux network (local / testnet / mainnet).
 *
 * Core Space addresses (net2029:… / cfxtest:… / cfx:…):
 *   - Derived from the same base address stored in the keystore, then
 *     re-encoded via CIP-37 for the currently selected network.
 *   - When local is selected and the node is running the API also provides
 *     live balances; otherwise balances are omitted.
 *
 * Click any address row to copy it to the clipboard.
 */

import * as vscode from "vscode";
import { getAccounts } from "../conflux/api";
import {
	type OfflineAccount,
	readKeystoreAccounts,
} from "../conflux/keystore-reader";
import { deriveCoreAddressForNetwork } from "../utils/core-address-display";
import { type NetworkSelection, networkState } from "./network-state";

// ── Internal enriched account ─────────────────────────────────────────────────

interface EnrichedAccount {
	index: number;
	/** Original Core address from keystore (net2029: format) */
	coreAddress: string;
	/** eSpace (EVM) address — network-independent, always 0x… */
	evmAddress: string;
	/** Core address re-encoded for the currently selected network */
	coreAddressForNetwork: string;
	coreBalance?: string;
	evmBalance?: string;
	coreBalanceState?: BalanceState;
	evmBalanceState?: BalanceState;
}

type BalanceState = "ok" | "low" | "error" | "unknown";

interface BalanceResult {
	value?: string;
	state: BalanceState;
}

// ── Tree item types ───────────────────────────────────────────────────────────

class AccountGroupItem extends vscode.TreeItem {
	constructor(
		readonly ea: EnrichedAccount,
		readonly prefix: string,
	) {
		super(`Account ${ea.index}`, vscode.TreeItemCollapsibleState.Collapsed);

		const evm = formatBalanceShort(ea.evmBalance, ea.evmBalanceState);
		const core = formatBalanceShort(ea.coreBalance, ea.coreBalanceState);
		this.description = `eSpace ${evm} | Core ${core}`;
		this.tooltip = [
			`Account ${ea.index}`,
			`eSpace: ${ea.evmAddress}`,
			`Core (${prefix}): ${ea.coreAddressForNetwork}`,
			`eSpace balance: ${evm}`,
			`Core balance: ${core}`,
		].join("\n");
		this.contextValue = "cfxAccount";
		this.iconPath = new vscode.ThemeIcon(
			"account",
			new vscode.ThemeColor(balanceStateToColor(overallAccountState(ea))),
		);
	}
}

class AddressItem extends vscode.TreeItem {
	constructor(
		readonly address: string,
		readonly chain: "Core" | "eSpace",
		readonly networkPrefix: string,
		readonly balance: string | undefined,
		readonly balanceState: BalanceState,
	) {
		super(
			chain === "eSpace" ? "eSpace" : `Core  (${networkPrefix})`,
			vscode.TreeItemCollapsibleState.None,
		);

		const fmtBalance = formatBalanceShort(balance, balanceState);

		this.description = fmtBalance;

		const addrShort =
			address.length > 20
				? `${address.slice(0, 12)}…${address.slice(-6)}`
				: address;
		this.label =
			chain === "eSpace"
				? `eSpace: ${addrShort}`
				: `Core (${networkPrefix}): ${addrShort}`;

		this.tooltip = [
			address,
			chain === "eSpace" ? "eSpace" : `Core (${networkPrefix})`,
			`Balance: ${fmtBalance}`,
			"Click to copy",
		]
			.filter(Boolean)
			.join("\n");

		this.command = {
			command: "cfxdevkit.copyAddress",
			title: "Copy Address",
			arguments: [address],
		};
		this.contextValue = "cfxAddressItem";
		this.iconPath = new vscode.ThemeIcon(
			chain === "Core" ? "symbol-key" : "globe",
			new vscode.ThemeColor(balanceStateToColor(balanceState)),
		);
	}
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class AccountsProvider
	implements vscode.TreeDataProvider<vscode.TreeItem>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		vscode.TreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private accounts: EnrichedAccount[] = [];
	private state: "idle" | "loading" | "error" = "idle";
	private errorMsg = "";
	private currentNetwork: NetworkSelection = "local";

	constructor() {
		// When the user switches networks, reformat Core addresses and redraw
		networkState.onDidChange((network) => {
			this.currentNetwork = network;
			this.rederiveCoreAddresses();
			this.refresh();
			void this.load().catch(() => undefined);
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * Load account data.
	 *
	 * 1. Try reading from the keystore file (offline-capable, always works for
	 *    plaintext keystores) — gives all addresses immediately.
	 * 2. If local network is selected and the devkit server is reachable,
	 *    enrich with live balances from the API.
	 */
	async load(): Promise<void> {
		this.state = "loading";
		this.currentNetwork = networkState.selected;
		this.refresh();

		// ── Step 1: offline keystore read ─────────────────────────────────────────
		const offline: OfflineAccount[] | null = readKeystoreAccounts();
		if (offline && offline.length > 0) {
			this.accounts = offline.map((a) => this.enrich(a));
			this.state = "idle";
			this.refresh(); // show addresses immediately without waiting for API
		}

		// ── Step 2: enrich with live balances when local node is available ────────
		if (networkState.selected === "local") {
			try {
				const apiAccounts = await getAccounts();
				this.accounts = apiAccounts.map((a) => ({
					index: a.index,
					coreAddress: a.coreAddress,
					evmAddress: a.evmAddress,
					coreAddressForNetwork: this.convertCore(a.coreAddress, a.evmAddress),
					coreBalance: a.coreBalance,
					evmBalance: a.evmBalance,
					coreBalanceState: parseBalanceState(a.coreBalance),
					evmBalanceState: parseBalanceState(a.evmBalance),
				}));
				this.state = "idle";
			} catch {
				// Offline data already loaded; just drop balances
				for (const a of this.accounts) {
					a.coreBalance = undefined;
					a.evmBalance = undefined;
					a.coreBalanceState = "unknown";
					a.evmBalanceState = "unknown";
				}
				if (this.accounts.length === 0) {
					this.state = "error";
					this.errorMsg = "Start the Conflux local node to see accounts.";
				}
			}
		} else {
			// For testnet / mainnet: fetch balances directly from selected network RPCs.
			if (this.accounts.length === 0) {
				this.state = "error";
				this.errorMsg = "Initialize wallet to see accounts.";
			} else {
				await this.loadPublicBalances(this.accounts, this.currentNetwork);
			}
		}

		this.refresh();
	}

	/** Stop showing balances when the node goes offline (addresses stay). */
	setNodeOffline(): void {
		for (const a of this.accounts) {
			a.coreBalance = undefined;
			a.evmBalance = undefined;
			a.coreBalanceState = "unknown";
			a.evmBalanceState = "unknown";
		}
		this.refresh();
	}

	/** Remove all data (e.g. on full stack shutdown). */
	clear(): void {
		this.accounts = [];
		this.state = "idle";
		this.refresh();
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private enrich(a: OfflineAccount): EnrichedAccount {
		return {
			...a,
			coreAddressForNetwork: this.convertCore(a.coreAddress, a.evmAddress),
			coreBalanceState: "unknown",
			evmBalanceState: "unknown",
		};
	}

	private async loadPublicBalances(
		accounts: EnrichedAccount[],
		_network: NetworkSelection,
	): Promise<void> {
		const cfg = networkState.config;

		await Promise.all(
			accounts.map(async (a) => {
				const [evm, core] = await Promise.all([
					fetchEvmBalance(cfg.espaceRpc, a.evmAddress),
					fetchCoreBalance(cfg.coreRpc, a.coreAddressForNetwork),
				]);

				a.evmBalance = evm.value;
				a.evmBalanceState = evm.state;
				a.coreBalance = core.value;
				a.coreBalanceState = core.state;
			}),
		);
	}

	private convertCore(coreAddress: string, evmAddress?: string): string {
		return deriveCoreAddressForNetwork({
			coreAddress,
			evmAddress,
			targetChainId: networkState.config.coreChainId,
		});
	}

	private rederiveCoreAddresses(): void {
		for (const a of this.accounts) {
			a.coreAddressForNetwork = this.convertCore(a.coreAddress, a.evmAddress);
		}
	}

	// ── TreeDataProvider ───────────────────────────────────────────────────────

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: vscode.TreeItem,
	): vscode.ProviderResult<vscode.TreeItem[]> {
		if (!element) {
			if (this.state === "loading") {
				const item = new vscode.TreeItem("Loading accounts…");
				item.iconPath = new vscode.ThemeIcon("loading~spin");
				return [item];
			}

			if (this.accounts.length === 0) {
				const msg = new vscode.TreeItem(
					this.state === "error" ? this.errorMsg : "No accounts found",
				);
				msg.iconPath = new vscode.ThemeIcon("info");
				const action = new vscode.TreeItem("Initialize wallet");
				action.iconPath = new vscode.ThemeIcon("key");
				action.command = {
					command: "cfxdevkit.initializeSetup",
					title: "Initialize Wallet",
				};
				return [msg, action];
			}

			const prefix = networkState.config.prefix;
			return this.accounts.map((a) => new AccountGroupItem(a, prefix));
		}

		if (element instanceof AccountGroupItem) {
			const prefix = networkState.config.prefix;
			return [
				new AddressItem(
					element.ea.evmAddress,
					"eSpace",
					prefix,
					element.ea.evmBalance,
					element.ea.evmBalanceState ?? "unknown",
				),
				new AddressItem(
					element.ea.coreAddressForNetwork,
					"Core",
					prefix,
					element.ea.coreBalance,
					element.ea.coreBalanceState ?? "unknown",
				),
			];
		}

		return [];
	}
}

function parseBalanceState(balance: string | undefined): BalanceState {
	if (balance === undefined) return "unknown";
	const n = Number(balance);
	if (Number.isNaN(n)) return "error";
	return n >= 1 ? "ok" : "low";
}

function formatBalanceShort(
	balance: string | undefined,
	state: BalanceState | undefined,
): string {
	if (state === "error") return "error";
	if (balance === undefined) return "n/a";
	const n = Number(balance);
	if (Number.isNaN(n)) return "error";
	return `${n.toLocaleString(undefined, { maximumFractionDigits: 4 })} CFX`;
}

function balanceStateToColor(state: BalanceState | undefined): string {
	if (state === "ok") return "testing.iconPassed";
	if (state === "low") return "testing.iconQueued";
	if (state === "error") return "testing.iconFailed";
	return "descriptionForeground";
}

function overallAccountState(account: EnrichedAccount): BalanceState {
	const s = [account.evmBalanceState, account.coreBalanceState];
	if (s.includes("error")) return "error";
	if (s.includes("low")) return "low";
	if (s.includes("ok")) return "ok";
	return "unknown";
}

async function fetchEvmBalance(
	rpcUrl: string,
	address: string,
): Promise<BalanceResult> {
	try {
		const result = await jsonRpc<string>(rpcUrl, "eth_getBalance", [
			address,
			"latest",
		]);
		if (typeof result !== "string") return { state: "error" };
		const wei = BigInt(result);
		const cfx = Number(wei) / 1e18;
		return {
			value: cfx.toString(),
			state: cfx >= 1 ? "ok" : "low",
		};
	} catch {
		return { state: "error" };
	}
}

async function fetchCoreBalance(
	rpcUrl: string,
	address: string,
): Promise<BalanceResult> {
	try {
		const result = await jsonRpc<string>(rpcUrl, "cfx_getBalance", [
			address,
			"latest_state",
		]);
		if (typeof result !== "string") return { state: "error" };
		const drip = BigInt(result);
		const cfx = Number(drip) / 1e18;
		return {
			value: cfx.toString(),
			state: cfx >= 1 ? "ok" : "low",
		};
	} catch {
		return { state: "error" };
	}
}

let rpcId = 1;

async function jsonRpc<T>(
	url: string,
	method: string,
	params: unknown[],
): Promise<T> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: rpcId++, method, params }),
		signal: AbortSignal.timeout(10_000),
	});
	const payload = (await response.json()) as {
		result?: T;
		error?: { message?: string };
	};
	if (payload.error) {
		throw new Error(payload.error.message ?? "RPC error");
	}
	if (payload.result === undefined) {
		throw new Error("RPC result missing");
	}
	return payload.result;
}
