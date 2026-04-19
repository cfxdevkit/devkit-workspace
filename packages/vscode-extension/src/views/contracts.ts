/**
 * views/contracts.ts
 *
 * TreeDataProvider for the "Conflux Contracts" sidebar view.
 *
 * Contract hierarchy:
 *   NetworkGroup (Local / Testnet / Mainnet / Custom)
 *   └── ChainGroup (eSpace / Core Space)
 *       └── ContractItem (collapsible if ABI stored)
 *           ├── AbiGroupItem "READ functions"
 *           │   └── AbiFunctionItem (view/pure)
 *           └── AbiGroupItem "WRITE functions"
 *               └── AbiFunctionItem (nonpayable/payable)
 *
 * Data source:
 *   conflux-devkit REST API (/api/contracts/deployed)
 *
 * Auto-refresh:
 *   - 15-second polling (catches API-side changes when node is running)
 *
 * Interaction:
 *   - READ fn → prompt args → call contract → show result in output
 *   - WRITE fn → pick account → prompt args → send tx → show receipt
 */

import * as vscode from "vscode";
import { type DeployedContract, getDeployedContracts } from "../conflux/api";
import type { AbiFunction } from "../conflux/rpc";
import { type NetworkSelection, networkState } from "./network-state";

/** Extended DeployedContract with ABI stored as JSON string for tree view + interaction */
export interface LocalContract extends Omit<DeployedContract, "abi"> {
	/** ABI as a JSON string — parsed from DeployedContract.abi[] or from .devkit-contracts.json */
	abi?: string;
	deployerAddress?: string;
}

// ── Tree item types ───────────────────────────────────────────────────────────

interface NetworkBucket {
	key: string;
	label: string;
	contracts: LocalContract[];
}

class NetworkGroupItem extends vscode.TreeItem {
	constructor(
		readonly bucket: NetworkBucket,
		readonly isActiveNetwork: boolean,
	) {
		super(bucket.label, vscode.TreeItemCollapsibleState.Expanded);
		this.description = isActiveNetwork
			? "active"
			: `${bucket.contracts.length} contract(s)`;
		this.contextValue = "cfxNetworkGroup";
		this.iconPath = new vscode.ThemeIcon("globe");
		this.tooltip = isActiveNetwork
			? `${bucket.label} (active network)`
			: `${bucket.label} (${bucket.contracts.length} contract(s))`;
	}
}

class ChainGroupItem extends vscode.TreeItem {
	constructor(
		readonly chainLabel: "eSpace" | "Core Space",
		readonly contracts: LocalContract[],
	) {
		super(chainLabel, vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${contracts.length} contract(s)`;
		this.contextValue = "cfxChainGroup";
		this.iconPath = new vscode.ThemeIcon(
			chainLabel === "eSpace" ? "globe" : "symbol-key",
		);
	}
}

class ContractItem extends vscode.TreeItem {
	constructor(readonly contract: LocalContract) {
		const name = contract.name ?? contract.id;
		const hasAbiFunctions = !!contract.abi;
		super(name, vscode.TreeItemCollapsibleState.Collapsed);
		this.tooltip = [
			`Name:    ${name}`,
			`Address: ${contract.address}`,
			`Network: ${networkLabelForContract(contract)}`,
			`Chain:   ${contract.chain === "evm" ? "eSpace" : "Core Space"}`,
			contract.deployedAt
				? `Deployed: ${new Date(contract.deployedAt).toLocaleString()}`
				: "",
			contract.txHash ? `Tx: ${contract.txHash}` : "",
			hasAbiFunctions
				? "\nExpand to interact with functions"
				: "\nExpand to copy the address",
		]
			.filter(Boolean)
			.join("\n");
		this.contextValue = "cfxContractItem";
		this.iconPath = new vscode.ThemeIcon("symbol-class");
	}

	parsedAbi(): AbiFunction[] {
		if (!this.contract.abi) return [];
		try {
			return (JSON.parse(this.contract.abi) as AbiFunction[]).filter(
				(e) => e.type === "function",
			);
		} catch {
			return [];
		}
	}
}

class ContractAddressItem extends vscode.TreeItem {
	constructor(readonly contract: LocalContract) {
		super("Address", vscode.TreeItemCollapsibleState.None);
		this.description = contract.address;
		this.tooltip = [contract.address, "Click to copy"].join("\n");
		this.command = {
			command: "cfxdevkit.copyAddress",
			title: "Copy Address",
			arguments: [contract.address],
		};
		this.contextValue = "cfxAddressItem";
		this.iconPath = new vscode.ThemeIcon("copy");
	}
}

class AbiGroupItem extends vscode.TreeItem {
	constructor(
		readonly label: string,
		readonly fns: AbiFunction[],
		readonly contract: LocalContract,
	) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.description = `${fns.length}`;
		this.contextValue = "cfxAbiGroup";
		this.iconPath = new vscode.ThemeIcon(label === "READ" ? "eye" : "edit");
	}
}

class AbiFunctionItem extends vscode.TreeItem {
	constructor(
		readonly fn: AbiFunction,
		readonly contract: LocalContract,
	) {
		const isPayable = fn.stateMutability === "payable";
		const sigArgs = fn.inputs
			.map((i) => `${i.type} ${i.name || ""}`.trim())
			.join(", ");
		const sig = `${fn.name}(${sigArgs})`;
		super(fn.name, vscode.TreeItemCollapsibleState.None);
		this.description = `${isPayable ? "[Payable] " : ""}(${sigArgs})`;
		this.tooltip = [
			sig,
			`Mutability: ${fn.stateMutability}`,
			`Contract: ${contract.name ?? contract.address}`,
			"",
			fn.stateMutability === "view" || fn.stateMutability === "pure"
				? "Click to call (read-only)"
				: "Click to send transaction",
		].join("\n");
		const isRead =
			fn.stateMutability === "view" || fn.stateMutability === "pure";
		this.command = {
			command: isRead ? "cfxdevkit.abiCallRead" : "cfxdevkit.abiCallWrite",
			title: isRead ? "Call (read)" : "Send transaction",
			arguments: [fn, contract],
		};
		this.contextValue = isRead ? "cfxAbiRead" : "cfxAbiWrite";
		this.iconPath = new vscode.ThemeIcon(
			isRead ? "symbol-property" : "symbol-event",
		);
	}
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class ContractsProvider
	implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		vscode.TreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private contracts: LocalContract[] = [];
	private state: "idle" | "loading" | "error" = "idle";
	private errorMsg = "";
	private _pollTimer: ReturnType<typeof setInterval> | undefined;
	private _currentNetwork: NetworkSelection = networkState.selected;

	constructor() {
		this.startPolling();
		networkState.onDidChange((network) => {
			this._currentNetwork = network;
			this.contracts = [];
			this.state = "idle";
			this.refresh();
			this.load().catch(() => undefined);
		});
	}

	dispose(): void {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = undefined;
		}
	}

	private startPolling(): void {
		this._pollTimer = setInterval(() => {
			this.load().catch(() => undefined);
		}, 5_000);
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	async load(): Promise<void> {
		// Show loading spinner only on first load (no flicker for poll updates)
		const firstLoad = this.state === "idle" && this.contracts.length === 0;
		if (firstLoad) {
			this.state = "loading";
			this.refresh();
		}

		try {
			let apiContracts: LocalContract[] = [];
			try {
				const raw = await getDeployedContracts();
				apiContracts = raw.map((c) => ({
					...c,
					abi: c.abi ? JSON.stringify(c.abi) : undefined,
				}));
			} catch {
				/* server not running — that's fine */
			}

			// Only re-render if data actually changed
			const oldJson = JSON.stringify(this.contracts.map((c) => c.id).sort());
			const newJson = JSON.stringify(apiContracts.map((c) => c.id).sort());
			this.contracts = apiContracts;
			this.state = "idle";
			if (firstLoad || oldJson !== newJson) {
				this.refresh();
			}
		} catch (e) {
			this.state = "error";
			this.errorMsg = e instanceof Error ? e.message : String(e);
			this.contracts = [];
			this.refresh();
		}
	}

	clear(): void {
		this.contracts = [];
		this.state = "idle";
		this.refresh();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: vscode.TreeItem,
	): vscode.ProviderResult<vscode.TreeItem[]> {
		if (!element) {
			if (this.state === "loading") {
				const item = new vscode.TreeItem("Loading contracts…");
				item.iconPath = new vscode.ThemeIcon("loading~spin");
				return [item];
			}
			if (this.state === "error") {
				const item = new vscode.TreeItem(`Error: ${this.errorMsg}`);
				item.iconPath = new vscode.ThemeIcon("error");
				return [item];
			}
			if (this.contracts.length === 0) {
				const item = new vscode.TreeItem("No contracts deployed yet");
				item.iconPath = new vscode.ThemeIcon("info");
				return [item];
			}

			const buckets = buildNetworkBuckets(this.contracts);
			const activeKey = this._currentNetwork;
			return buckets.map(
				(bucket) => new NetworkGroupItem(bucket, bucket.key === activeKey),
			);
		}

		if (element instanceof NetworkGroupItem) {
			const evmContracts = element.bucket.contracts.filter(
				(c) => c.chain === "evm",
			);
			const coreContracts = element.bucket.contracts.filter(
				(c) => c.chain === "core",
			);
			const groups: ChainGroupItem[] = [];
			if (evmContracts.length > 0)
				groups.push(new ChainGroupItem("eSpace", evmContracts));
			if (coreContracts.length > 0)
				groups.push(new ChainGroupItem("Core Space", coreContracts));
			return groups;
		}

		if (element instanceof ChainGroupItem) {
			return element.contracts.map((c) => new ContractItem(c));
		}

		if (element instanceof ContractItem) {
			const fns = element.parsedAbi();
			const items: vscode.TreeItem[] = [
				new ContractAddressItem(element.contract),
			];
			if (!fns.length) return items;
			const reads = fns.filter(
				(f) => f.stateMutability === "view" || f.stateMutability === "pure",
			);
			const writes = fns.filter(
				(f) => f.stateMutability !== "view" && f.stateMutability !== "pure",
			);
			if (reads.length)
				items.push(new AbiGroupItem("READ", reads, element.contract));
			if (writes.length)
				items.push(new AbiGroupItem("WRITE", writes, element.contract));
			return items;
		}

		if (element instanceof AbiGroupItem) {
			return element.fns.map((fn) => new AbiFunctionItem(fn, element.contract));
		}

		return [];
	}
}

function buildNetworkBuckets(contracts: LocalContract[]): NetworkBucket[] {
	const map = new Map<string, NetworkBucket>();

	for (const contract of contracts) {
		const key = inferNetworkKey(contract);
		const label = networkLabelFromKey(key, contract);
		const existing = map.get(key);
		if (existing) {
			existing.contracts.push(contract);
		} else {
			map.set(key, { key, label, contracts: [contract] });
		}
	}

	const preferredOrder: Record<string, number> = {
		local: 0,
		testnet: 1,
		mainnet: 2,
	};
	return Array.from(map.values()).sort((a, b) => {
		const pa = preferredOrder[a.key] ?? 99;
		const pb = preferredOrder[b.key] ?? 99;
		if (pa !== pb) return pa - pb;
		return a.label.localeCompare(b.label);
	});
}

function inferNetworkKey(contract: LocalContract): string {
	const cid = contract.chainId;
	if (cid === 2029 || cid === 2030) return "local";
	if (cid === 1 || cid === 71) return "testnet";
	if (cid === 1029 || cid === 1030) return "mainnet";

	const mode = contract.metadata?.mode;
	if (typeof mode === "string" && mode === "local") return "local";

	return `chain-${cid ?? "unknown"}`;
}

function networkLabelFromKey(key: string, contract: LocalContract): string {
	if (key === "local") return "Local";
	if (key === "testnet") return "Testnet";
	if (key === "mainnet") return "Mainnet";

	if (typeof contract.chainId === "number") {
		return `Custom (chain ${contract.chainId})`;
	}

	return "Custom";
}

function networkLabelForContract(contract: LocalContract): string {
	const key = inferNetworkKey(contract);
	return networkLabelFromKey(key, contract);
}
