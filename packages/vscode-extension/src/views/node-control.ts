/**
 * views/node-control.ts
 *
 * TreeDataProvider for the "Local Node" sidebar view.
 *
 * Structure:
 *   ⬤  Running (10 accounts)                  ← status line (non-clickable)
 *   ▶  Start Node
 *   ■  Stop Node
 *   ↺  Restart Node
 *   ⚠  Wipe & Restart
 *   ↗  Open DevKit UI
 *
 * The status bar poller calls setLocalNodeState() to keep this view in sync
 * with the same state it displays, avoiding duplicate API polling.
 * Only visible when the "local" network is selected.
 */

import * as vscode from "vscode";
import { networkState } from "./network-state";

// ── Local node states (mirrors statusbar-conflux states) ─────────────────────

export type LocalNodeState =
	| "offline" // devkit server not reachable
	| "setup-req" // server up, keystore not initialized
	| "locked" // keystore locked
	| "stopped" // server + keystore OK, node stopped
	| "starting" // node transitioning
	| "running" // node running
	| "unknown"; // initial / transitional

// ── Internal tree item types ──────────────────────────────────────────────────

class NodeStatusItem extends vscode.TreeItem {
	constructor(text: string, icon: string, colorId?: string, cmd?: string) {
		super(text, vscode.TreeItemCollapsibleState.None);
		this.iconPath = colorId
			? new vscode.ThemeIcon(icon, new vscode.ThemeColor(colorId))
			: new vscode.ThemeIcon(icon);
		if (cmd) {
			this.command = { command: cmd, title: text };
		}
		this.contextValue = "cfxNodeStatus";
	}
}

class NodeActionItem extends vscode.TreeItem {
	constructor(label: string, icon: string, cmd: string, tooltip?: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon(icon);
		this.command = { command: cmd, title: label };
		this.tooltip = tooltip ?? label;
		this.contextValue = "cfxNodeAction";
	}
}

class NodeDividerItem extends vscode.TreeItem {
	constructor() {
		super("──────── Actions ────────", vscode.TreeItemCollapsibleState.None);
		this.iconPath = new vscode.ThemeIcon("dash");
		this.contextValue = "cfxNodeDivider";
	}
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class NodeControlProvider
	implements vscode.TreeDataProvider<vscode.TreeItem>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		vscode.TreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private localState: LocalNodeState = "unknown";
	private accountCount = 0;

	constructor() {
		networkState.onDidChange(() => this.refresh());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	/**
	 * Called by the status bar poller each refresh cycle so the tree stays
	 * in sync without independent polling.
	 */
	setLocalNodeState(state: LocalNodeState, accountCount = 0): void {
		if (this.localState === state && this.accountCount === accountCount) return;
		this.localState = state;
		this.accountCount = accountCount;
		this.refresh();
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: vscode.TreeItem,
	): vscode.ProviderResult<vscode.TreeItem[]> {
		if (element) return [];

		// Only show controls when local network is selected
		if (networkState.selected !== "local") {
			const info = new vscode.TreeItem(
				"Switch to Local network to manage the node",
				vscode.TreeItemCollapsibleState.None,
			);
			info.iconPath = new vscode.ThemeIcon("info");
			info.command = {
				command: "cfxdevkit.selectNetwork",
				title: "Select Network",
				arguments: ["local"],
			};
			return [info];
		}

		const items: vscode.TreeItem[] = [];

		const { text, icon, colorId } = this.statusDisplay();
		const stoppedAction =
			this.localState === "stopped" ? "cfxdevkit.nodeStoppedChoice" : undefined;
		items.push(new NodeStatusItem(text, icon, colorId, stoppedAction));
		items.push(new NodeDividerItem());

		switch (this.localState) {
			case "offline":
				items.push(
					new NodeActionItem(
						"Start DevKit",
						"server-process",
						"cfxdevkit.serverStart",
						"Launch the conflux-devkit local server process",
					),
				);
				break;

			case "setup-req":
				items.push(
					new NodeActionItem(
						"Init Wallet",
						"key",
						"cfxdevkit.initializeSetup",
						"Run the wallet setup wizard to configure keystore and mnemonic",
					),
				);
				break;

			case "locked":
				items.push(
					new NodeActionItem(
						"Unlock",
						"lock",
						"cfxdevkit.unlockKeystore",
						"Enter password to unlock the encrypted keystore",
					),
				);
				break;

			default: {
				// Server is reachable (stopped / starting / running / unknown)
				if (this.localState !== "running" && this.localState !== "starting") {
					items.push(
						new NodeActionItem("Start Node", "play", "cfxdevkit.nodeStart"),
					);
				}
				if (this.localState === "running" || this.localState === "starting") {
					items.push(
						new NodeActionItem("Stop Node", "debug-stop", "cfxdevkit.nodeStop"),
					);
					items.push(
						new NodeActionItem(
							"Restart Node",
							"debug-restart",
							"cfxdevkit.nodeRestart",
						),
					);
				}
				items.push(
					new NodeActionItem(
						"Wipe & Restart",
						"warning",
						"cfxdevkit.nodeWipeRestart",
						"⚠ Wipes all blockchain data and restarts fresh (troubleshooting)",
					),
				);
				break;
			}
		}

		return items;
	}

	private statusDisplay(): { text: string; icon: string; colorId?: string } {
		switch (this.localState) {
			case "offline":
				return { text: "Server offline", icon: "circle-slash" };
			case "setup-req":
				return {
					text: "Wallet setup required",
					icon: "key",
					colorId: "notificationsWarningIcon.foreground",
				};
			case "locked":
				return {
					text: "Keystore locked",
					icon: "lock",
					colorId: "notificationsWarningIcon.foreground",
				};
			case "stopped":
				return {
					text: "Node stopped",
					icon: "debug-stop",
					colorId: "testing.iconFailed",
				};
			case "starting":
				return { text: "Node starting…", icon: "loading~spin" };
			case "running":
				return {
					text:
						this.accountCount > 0
							? `Running  (${this.accountCount} accounts)`
							: "Running",
					icon: "flame",
					colorId: "testing.iconPassed",
				};
			default:
				return { text: "Checking…", icon: "loading~spin" };
		}
	}
}
