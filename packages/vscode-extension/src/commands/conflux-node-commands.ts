import * as vscode from "vscode";
import {
	getKeystoreStatus,
	restartNode,
	restartWipe,
	startNode,
	stopNode,
	wipe,
} from "../conflux/api";

type ConfluxProviders = {
	accounts: { load(): Promise<void>; clear(): void };
	contracts: { load(): Promise<void>; clear(): void };
};

async function clearDexState(): Promise<void> {
	const dexPort =
		vscode.workspace.getConfiguration("cfxdevkit").get<number>("dexPort") ??
		8888;
	try {
		await fetch(`http://127.0.0.1:${dexPort}/api/dex/state`, {
			method: "DELETE",
			signal: AbortSignal.timeout(3_000),
		});
	} catch {
		// DEX may not be running.
	}
}

export function registerNodeLifecycleCommands(params: {
	context: vscode.ExtensionContext;
	providers?: ConfluxProviders;
	requireServerOnline: () => Promise<boolean>;
}): void {
	const { context, providers, requireServerOnline } = params;

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.nodeStart", async () => {
			if (!(await requireServerOnline())) return;

			try {
				const ks = await getKeystoreStatus();
				if (!ks.initialized) {
					const action = await vscode.window.showErrorMessage(
						"Keystore not initialized. Run the wallet setup wizard first.",
						"Initialize Wallet",
					);
					if (action === "Initialize Wallet") {
						vscode.commands.executeCommand("cfxdevkit.initializeSetup");
					}
					return;
				}
				if (ks.locked) {
					const action = await vscode.window.showErrorMessage(
						"Keystore is locked. Unlock it before starting the node.",
						"Unlock",
					);
					if (action === "Unlock") {
						vscode.commands.executeCommand("cfxdevkit.unlockKeystore");
					}
					return;
				}
			} catch {
				// If keystore check fails, try starting anyway.
			}

			try {
				const status = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Starting Conflux node…",
						cancellable: false,
					},
					(progress) => {
						progress.report({
							message: "Initializing node (this may take up to 30s)…",
						});
						return startNode();
					},
				);
				const rpc = status.rpcUrls
					? `  Core: ${status.rpcUrls.core}  eSpace: ${status.rpcUrls.evm}`
					: "";
				vscode.window
					.showInformationMessage(
						`✅ Conflux node started (${status.accounts} accounts).${rpc}`,
						"View Accounts",
					)
					.then((a) => {
						if (a === "View Accounts")
							vscode.commands.executeCommand("cfxdevkit.viewAccounts");
					});
				providers?.accounts.load();
				providers?.contracts.load();
			} catch (err) {
				const errMsg = err instanceof Error ? err.message : String(err);
				let userMsg = errMsg;
				if (errMsg.includes("ECONNREFUSED"))
					userMsg = "Cannot connect to devkit server. Is it running?";
				else if (errMsg.includes("timeout"))
					userMsg = "Node start timed out. The node may still be initializing.";
				else if (errMsg.length > 120) userMsg = `${errMsg.slice(0, 120)}…`;
				const action = await vscode.window.showErrorMessage(
					`Failed to start node: ${userMsg}`,
					"Wipe & Restart",
					"Show Logs",
				);
				if (action === "Wipe & Restart") {
					vscode.commands.executeCommand("cfxdevkit.nodeWipeRestart");
				}
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.nodeStop", async () => {
			if (!(await requireServerOnline())) return;
			const confirm = await vscode.window.showWarningMessage(
				"Stop the Conflux dev node?",
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
				vscode.window.showErrorMessage(
					`Failed to stop node: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.nodeRestart", async () => {
			if (!(await requireServerOnline())) return;
			try {
				const status = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Restarting Conflux node…",
						cancellable: false,
					},
					(progress) => {
						progress.report({
							message: "Stopping and restarting (preserving data)…",
						});
						return restartNode();
					},
				);
				vscode.window
					.showInformationMessage(
						`✅ Conflux node restarted. Status: ${status.server}`,
						"View Accounts",
					)
					.then((a) => {
						if (a === "View Accounts")
							vscode.commands.executeCommand("cfxdevkit.viewAccounts");
					});
				providers?.accounts.load();
				providers?.contracts.load();
			} catch (err) {
				const action = await vscode.window.showErrorMessage(
					`Restart failed: ${err instanceof Error ? err.message : String(err)}`,
					"Wipe & Restart",
				);
				if (action === "Wipe & Restart") {
					vscode.commands.executeCommand("cfxdevkit.nodeWipeRestart");
				}
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.nodeWipeRestart", async () => {
			if (!(await requireServerOnline())) return;
			const confirm = await vscode.window.showWarningMessage(
				"⚠️ This will wipe all blockchain data and restart fresh.\n\nDeployed contracts and balances will be lost.\nYour mnemonic and account addresses are preserved.",
				{ modal: true },
				"Wipe & Restart",
			);
			if (confirm !== "Wipe & Restart") return;
			try {
				const status = await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Wiping data and restarting node…",
						cancellable: false,
					},
					(progress) => {
						progress.report({
							message: "Erasing blockchain data and restarting fresh…",
						});
						return restartWipe();
					},
				);
				providers?.accounts.clear();
				providers?.contracts.clear();
				await clearDexState();
				providers?.accounts.load();
				providers?.contracts.load();
				vscode.window
					.showInformationMessage(
						`✅ Node wiped and restarted. Status: ${status.server}`,
						"View Accounts",
					)
					.then((a) => {
						if (a === "View Accounts")
							vscode.commands.executeCommand("cfxdevkit.viewAccounts");
					});
			} catch (err) {
				vscode.window.showErrorMessage(
					`Wipe-restart failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.nodeWipe", async () => {
			if (!(await requireServerOnline())) return;
			const confirm = await vscode.window.showWarningMessage(
				"⚠️ This will stop the node and wipe all blockchain data. Start the node manually afterwards.",
				{ modal: true },
				"Wipe Data",
			);
			if (confirm !== "Wipe Data") return;
			try {
				await wipe();
				providers?.accounts.clear();
				providers?.contracts.clear();
				await clearDexState();
				vscode.window
					.showInformationMessage(
						'Blockchain data wiped. Use "Conflux: Start Node" to restart.',
						"Start Node",
					)
					.then((a) => {
						if (a === "Start Node")
							vscode.commands.executeCommand("cfxdevkit.nodeStart");
					});
			} catch (err) {
				vscode.window.showErrorMessage(
					`Wipe failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);
}
