/**
 * statusbar-conflux.ts
 *
 * Status bar item for Conflux — reflects both the selected network and the
 * local dev node lifecycle state.
 *
 * States when local network selected:
 *   $(circle-slash) CFX: –            — server not reachable
 *   $(key)          CFX: setup req    — keystore not initialized
 *   $(lock)         CFX: locked       — keystore is locked
 *   $(debug-stop)   CFX: stopped      — node stopped
 *   $(loading~spin) CFX: starting     — node transitioning
 *   $(flame)        CFX: local (N)    — node running with N accounts
 *
 * States when testnet / mainnet selected:
 *   $(globe)        CFX: testnet      — no local node management
 *   $(globe)        CFX: mainnet
 *
 * The poller also calls nodeControlProvider.setLocalNodeState() so the Node
 * Control tree view stays in sync without duplicating API calls.
 */

import * as vscode from "vscode";
import {
	getCurrentNetwork,
	getKeystoreStatus,
	getNodeStatus,
	isServerOnline,
} from "./conflux/api";
import {
	isServerProcessRunning,
	showDevkitProcessLogs,
} from "./conflux/process";
import { resolveNetworkSelection } from "./views/network-selection";
import { networkState } from "./views/network-state";
import type { NodeControlProvider } from "./views/node-control";
import { nodeRunningState } from "./views/node-state";

const POLL_INTERVAL_MS = 10_000;

export function registerConfluxStatusBar(
	context: vscode.ExtensionContext,
	nodeControl?: NodeControlProvider,
): void {
	const bar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		9,
	);
	bar.text = "$(loading~spin) CFX: –";

	function isEnabled(): boolean {
		return vscode.workspace
			.getConfiguration("cfxdevkit")
			.get<boolean>("enabled", true);
	}

	function applyVisibility(): void {
		if (isEnabled()) bar.show();
		else bar.hide();
	}

	applyVisibility();
	context.subscriptions.push(bar);

	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("cfxdevkit.enabled")) applyVisibility();
		}),
	);

	// Re-render immediately when the user switches networks
	context.subscriptions.push(networkState.onDidChange(() => void refresh()));

	async function syncSelectedNetworkFromBackend(): Promise<void> {
		try {
			const current = await getCurrentNetwork();
			const resolved = resolveNetworkSelection(current);
			if (resolved && resolved !== networkState.selected) {
				networkState.select(resolved);
			}
		} catch {
			// Ignore transient backend sync errors during status refresh.
		}
	}

	async function refresh(): Promise<void> {
		try {
			const online = await isServerOnline();
			if (online) {
				await syncSelectedNetworkFromBackend();
			}

			const selected = networkState.selected;

			// ── Non-local networks — just show a static indicator ─────────────────
			if (selected !== "local") {
				const cfg = networkState.config;
				bar.text = `$(globe) CFX: ${cfg.label}`;
				bar.backgroundColor = undefined;
				bar.tooltip = [
					`Connected to ${cfg.label}.`,
					`Core chainId: ${cfg.coreChainId}  eSpace chainId: ${cfg.espaceChainId}`,
					online
						? "DevKit server online (public mode). Click to switch network."
						: "DevKit server offline. Start server to deploy/manage contracts.",
				].join("\n");
				bar.command = "cfxdevkit.selectNetwork";
				nodeControl?.setLocalNodeState("offline", 0);
				nodeRunningState.update(online, false);
				return;
			}

			// ── Local network — check server / keystore / node ────────────────────
			if (!online) {
				if (isServerProcessRunning()) {
					bar.text = "$(loading~spin) CFX: server starting";
					bar.backgroundColor = undefined;
					bar.tooltip =
						"Conflux devkit server process is running but the API is not ready yet. Click for options.";
					bar.command = "cfxdevkit.serverStartingChoice";
					nodeControl?.setLocalNodeState("starting", 0);
					nodeRunningState.update(false, false);
					return;
				}

				bar.text = "$(circle-slash) CFX: offline";
				bar.backgroundColor = undefined;
				bar.tooltip =
					"Conflux devkit server is offline.\nClick to start the DevKit server.";
				bar.command = "cfxdevkit.serverStart";
				nodeControl?.setLocalNodeState("offline", 0);
				nodeRunningState.update(false, false);
				return;
			}

			// Check keystore state before querying node
			try {
				const ks = await getKeystoreStatus();
				if (!ks.initialized) {
					bar.text = "$(key) CFX: setup req";
					bar.backgroundColor = new vscode.ThemeColor(
						"statusBarItem.warningBackground",
					);
					bar.tooltip =
						"Keystore not initialized. Click to run the wallet setup wizard.";
					bar.command = "cfxdevkit.initializeSetup";
					nodeControl?.setLocalNodeState("setup-req", 0);
					nodeRunningState.update(true, false);
					return;
				}
				if (ks.locked) {
					bar.text = "$(lock) CFX: locked";
					bar.backgroundColor = new vscode.ThemeColor(
						"statusBarItem.warningBackground",
					);
					bar.tooltip = "Keystore is locked. Click to unlock.";
					bar.command = "cfxdevkit.unlockKeystore";
					nodeControl?.setLocalNodeState("locked", 0);
					nodeRunningState.update(true, false);
					return;
				}
			} catch {
				// If keystore check fails, fall through to node status
			}

			bar.command = "cfxdevkit.confluxBarClick";
			const status = await getNodeStatus();

			switch (status.server) {
				case "running": {
					const n = status.accounts;
					const port =
						vscode.workspace
							.getConfiguration("cfxdevkit")
							.get<number>("port") ?? 7748;
					bar.text = `$(flame) CFX: local (${n})`;
					bar.backgroundColor = undefined;
					bar.tooltip = [
						"Conflux local dev node is running.",
						`DevKit UI: http://localhost:${port}`,
						"Click to open DevKit UI or manage the node.",
					].join("\n");
					nodeControl?.setLocalNodeState("running", n);
					nodeRunningState.update(true, true);
					break;
				}
				case "starting":
				case "stopping":
					bar.text = `$(loading~spin) CFX: ${status.server}`;
					bar.backgroundColor = undefined;
					bar.tooltip = `Conflux node is ${status.server}…`;
					nodeControl?.setLocalNodeState("starting", 0);
					nodeRunningState.update(true, false);
					break;
				case "stopped":
					bar.text = "$(debug-stop) CFX: stopped";
					bar.backgroundColor = new vscode.ThemeColor(
						"statusBarItem.warningBackground",
					);
					bar.tooltip =
						"Conflux node is stopped. Click to choose: Start Node or Switch Network.";
					bar.command = "cfxdevkit.nodeStoppedChoice";
					nodeControl?.setLocalNodeState("stopped", 0);
					nodeRunningState.update(true, false);
					break;
				default:
					bar.text = `$(warning) CFX: ${status.server}`;
					bar.backgroundColor = new vscode.ThemeColor(
						"statusBarItem.warningBackground",
					);
					bar.tooltip = `Conflux node status: ${status.server}. Try "Conflux: Wipe Data & Restart Node" if stuck.`;
					nodeControl?.setLocalNodeState("unknown", 0);
					nodeRunningState.update(true, false);
			}
		} catch {
			bar.text = "$(circle-slash) CFX: offline";
			bar.backgroundColor = undefined;
			nodeRunningState.update(false, false);
		}
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.nodeStoppedChoice", async () => {
			const pick = await vscode.window.showQuickPick(
				[
					{ label: "$(play) Start Node", id: "start" },
					{ label: "$(globe) Switch Network", id: "network" },
					{ label: "$(output) View Server Logs", id: "logs" },
					{ label: "$(stop-circle) Stop Server", id: "serverStop" },
				],
				{ placeHolder: "Conflux node is stopped — choose an action" },
			);
			if (!pick) return;
			switch (pick.id) {
				case "start":
					vscode.commands.executeCommand("cfxdevkit.nodeStart");
					return;
				case "network":
					vscode.commands.executeCommand("cfxdevkit.selectNetwork");
					return;
				case "logs":
					void showDevkitProcessLogs();
					return;
				case "serverStop":
					vscode.commands.executeCommand("cfxdevkit.serverStop");
					return;
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cfxdevkit.serverStartingChoice",
			async () => {
				const pick = await vscode.window.showQuickPick(
					[
						{ label: "$(output) View Server Logs", id: "logs" },
						{ label: "$(stop-circle) Stop Server", id: "stop" },
					],
					{ placeHolder: "DevKit server is starting…" },
				);
				if (!pick) return;
				if (pick.id === "logs") {
					void showDevkitProcessLogs();
					return;
				}
				if (pick.id === "stop") {
					vscode.commands.executeCommand("cfxdevkit.serverStop");
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.confluxBarClick", async () => {
			const port =
				vscode.workspace.getConfiguration("cfxdevkit").get<number>("port") ??
				7748;
			const pick = await vscode.window.showQuickPick(
				[
					{ label: "$(link-external) Open DevKit UI", id: "ui" },
					{ label: "$(globe) Switch Network", id: "network" },
					{ label: "$(output) View Server Logs", id: "logs" },
					{ label: "$(person) View Accounts", id: "accounts" },
					{ label: "$(database) Mine Blocks", id: "mine" },
					{ label: "$(debug-restart) Restart Node", id: "restart" },
					{ label: "$(debug-stop) Stop Node", id: "stop" },
				],
				{
					placeHolder: `Conflux local dev node — DevKit UI: http://localhost:${port}`,
				},
			);
			if (!pick) return;
			const cmds: Record<string, string> = {
				ui: "cfxdevkit.openUI",
				network: "cfxdevkit.selectNetwork",
				accounts: "cfxdevkit.viewAccounts",
				mine: "cfxdevkit.mineBlocks",
				restart: "cfxdevkit.nodeRestart",
				stop: "cfxdevkit.nodeStop",
			};
			if (pick.id === "logs") {
				void showDevkitProcessLogs();
				return;
			}
			const cmd = cmds[pick.id];
			if (cmd) vscode.commands.executeCommand(cmd);
		}),
	);

	void refresh();
	const timer = setInterval(() => {
		if (isEnabled()) void refresh();
	}, POLL_INTERVAL_MS);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
