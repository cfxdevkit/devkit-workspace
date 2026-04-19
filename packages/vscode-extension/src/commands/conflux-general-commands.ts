import * as vscode from "vscode";
import { getAccounts, isServerOnline, mine, stopNode } from "../conflux/api";
import {
	isServerProcessRunning,
	showDevkitProcessLogs,
	startDevkitProcess,
} from "../conflux/process";
import { deriveCoreAddressForNetwork } from "../utils/core-address-display";
import { networkState } from "../views/network-state";

type ConfluxProviders = {
	accounts: { load(): Promise<void>; clear(): void };
	contracts: { load(): Promise<void>; clear(): void };
};

export function registerGeneralConfluxCommands(params: {
	context: vscode.ExtensionContext;
	providers?: ConfluxProviders;
	requireServerOnline: () => Promise<boolean>;
	checkKeystoreAndPrompt: () => Promise<void>;
}): void {
	const { context, providers, requireServerOnline, checkKeystoreAndPrompt } =
		params;

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cfxdevkit.copyAddress",
			async (input: unknown) => {
				let address = "";
				if (typeof input === "string") {
					address = input;
				} else if (input && typeof input === "object") {
					const candidate = input as {
						address?: unknown;
						label?: unknown;
						tooltip?: unknown;
					};
					if (typeof candidate.address === "string")
						address = candidate.address;
					else if (typeof candidate.label === "string") {
						const m = candidate.label.match(
							/(0x[a-fA-F0-9]{40}|(cfx|cfxtest|net\d+):[a-z0-9]+)/,
						);
						address = m?.[1] ?? "";
					} else if (typeof candidate.tooltip === "string") {
						const m = candidate.tooltip.match(
							/(0x[a-fA-F0-9]{40}|(cfx|cfxtest|net\d+):[a-z0-9]+)/,
						);
						address = m?.[1] ?? "";
					}
				}
				if (!address) {
					vscode.window.showWarningMessage("No address found to copy.");
					return;
				}

				await vscode.env.clipboard.writeText(address);
				vscode.window.showInformationMessage(`Copied: ${address}`);
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.serverStart", async () => {
			if (await isServerOnline()) {
				vscode.window.showInformationMessage(
					"conflux-devkit server is already running.",
				);
				checkKeystoreAndPrompt();
				return;
			}
			if (isServerProcessRunning()) {
				vscode.window.showInformationMessage(
					"conflux-devkit server is already running.",
				);
				return;
			}
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "Starting conflux-devkit server…",
					cancellable: false,
				},
				async () => {
					await startDevkitProcess();
				},
			);
			vscode.window
				.showInformationMessage("conflux-devkit server started.", "View Logs")
				.then((a) => {
					if (a === "View Logs") void showDevkitProcessLogs();
				});
			checkKeystoreAndPrompt();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.serverStop", async () => {
			if (!(await isServerOnline())) {
				vscode.window.showInformationMessage("Conflux node is not running.");
				return;
			}
			const confirm = await vscode.window.showWarningMessage(
				"Stop the Conflux node?",
				{ modal: true },
				"Stop Node",
			);
			if (confirm !== "Stop Node") return;
			try {
				await stopNode();
				vscode.window
					.showInformationMessage(
						"Conflux node stopped. Blockchain data preserved.",
						"Start Node",
					)
					.then((a) => {
						if (a === "Start Node")
							vscode.commands.executeCommand("cfxdevkit.nodeStart");
					});
				providers?.accounts.clear();
				providers?.contracts.clear();
			} catch (err) {
				const action = await vscode.window.showErrorMessage(
					`Stop failed: ${err instanceof Error ? err.message : String(err)}`,
					"Wipe & Restart",
					"Show Logs",
				);
				if (action === "Wipe & Restart")
					vscode.commands.executeCommand("cfxdevkit.nodeWipeRestart");
				if (action === "Show Logs") void showDevkitProcessLogs();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.openUI", async () => {
			const port =
				vscode.workspace.getConfiguration("cfxdevkit").get<number>("port") ??
				7748;
			const uri = await vscode.env.asExternalUri(
				vscode.Uri.parse(`http://127.0.0.1:${port}/`),
			);
			vscode.env.openExternal(uri);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.viewAccounts", async () => {
			if (!(await requireServerOnline())) return;
			try {
				const accounts = await getAccounts();
				if (!accounts.length) {
					vscode.window.showInformationMessage(
						"No accounts found. Is the Conflux node running?",
					);
					return;
				}
				const channel = vscode.window.createOutputChannel("Conflux Accounts", {
					log: true,
				});
				channel.clear();
				channel.appendLine("═══ Conflux Genesis Accounts ═══\n");
				channel.appendLine(
					`Core Space (chainId: ${networkState.config.coreChainId})  |  eSpace (chainId: ${networkState.config.espaceChainId})`,
				);
				channel.appendLine(`Network: ${networkState.config.label}`);
				channel.appendLine("");
				for (const acc of accounts) {
					const displayedCoreAddress = deriveCoreAddressForNetwork({
						coreAddress: acc.coreAddress,
						evmAddress: acc.evmAddress,
						targetChainId: networkState.config.coreChainId,
					});
					channel.appendLine(
						`[${acc.index}] Core:   ${displayedCoreAddress}${acc.coreBalance ? `  (${acc.coreBalance} CFX)` : ""}`,
					);
					channel.appendLine(
						`      eSpace: ${acc.evmAddress}${acc.evmBalance ? `  (${acc.evmBalance} CFX)` : ""}`,
					);
					channel.appendLine("");
				}
				channel.show(true);
			} catch (err) {
				const action = await vscode.window.showErrorMessage(
					`Failed to get accounts: ${err instanceof Error ? err.message : String(err)}`,
					"Retry",
					"Show Logs",
				);
				if (action === "Retry")
					vscode.commands.executeCommand("cfxdevkit.viewAccounts");
				if (action === "Show Logs") void showDevkitProcessLogs();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.mineBlocks", async () => {
			if (!(await requireServerOnline())) return;
			const input = await vscode.window.showInputBox({
				title: "Conflux: Mine Blocks",
				prompt: "Number of blocks to mine",
				value: "1",
				validateInput: (v) =>
					Number.isInteger(Number(v)) && Number(v) > 0
						? null
						: "Enter a positive integer",
			});
			if (input === undefined) return;
			const blocks = Number.parseInt(input, 10);
			try {
				await mine(blocks);
				vscode.window.showInformationMessage(
					`⛏ Mined ${blocks} block(s) on Conflux.`,
				);
				providers?.accounts.load();
			} catch (err) {
				const action = await vscode.window.showErrorMessage(
					`Mine failed: ${err instanceof Error ? err.message : String(err)}`,
					"Retry",
					"Show Logs",
				);
				if (action === "Retry")
					vscode.commands.executeCommand("cfxdevkit.mineBlocks");
				if (action === "Show Logs") void showDevkitProcessLogs();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.shutdown", async () => {
			const confirm = await vscode.window.showWarningMessage(
				"Stop the Conflux node? The devkit backend will remain running.",
				{ modal: true },
				"Stop Node",
			);
			if (confirm !== "Stop Node") return;

			try {
				if (await isServerOnline()) {
					await stopNode();
				}
				providers?.accounts.clear();
				providers?.contracts.clear();
				vscode.window.showInformationMessage("Conflux node stopped.");
			} catch (err) {
				const action = await vscode.window.showErrorMessage(
					`Shutdown failed: ${err instanceof Error ? err.message : String(err)}`,
					"Wipe & Restart",
					"Show Logs",
				);
				if (action === "Wipe & Restart")
					vscode.commands.executeCommand("cfxdevkit.nodeWipeRestart");
				if (action === "Show Logs") void showDevkitProcessLogs();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.refreshAccounts", () => {
			providers?.accounts.load();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.refreshContracts", () => {
			providers?.contracts.load();
		}),
	);

	const autoStart =
		vscode.workspace.getConfiguration("cfxdevkit").get<boolean>("autoStart") ??
		false;
	if (autoStart && !isServerProcessRunning()) {
		startDevkitProcess()
			.then(() => checkKeystoreAndPrompt())
			.catch((err) => {
				vscode.window.showWarningMessage(
					`cfxdevkit auto-start failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			});
	}
}
