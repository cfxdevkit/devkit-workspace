import * as vscode from "vscode";
import {
	getKeystoreStatus,
	getNodeStatus,
	isServerOnline,
} from "../conflux/api";

export async function requireServerOnline(): Promise<boolean> {
	const online = await isServerOnline();
	if (!online) {
		const action = await vscode.window.showErrorMessage(
			"conflux-devkit server is not running.",
			"Start Server",
		);
		if (action === "Start Server") {
			await vscode.commands.executeCommand("cfxdevkit.serverStart");
		}
		return false;
	}
	return true;
}

/**
 * After server starts, check if keystore needs initialization.
 * Shows a notification prompting user to run the setup wizard.
 */
export async function checkKeystoreAndPrompt(): Promise<void> {
	try {
		await new Promise((r) => setTimeout(r, 1500)); // wait for server to be ready
		const ks = await getKeystoreStatus();
		if (!ks.initialized) {
			const action = await vscode.window.showWarningMessage(
				"Conflux DevKit: Keystore not initialized. Run the setup wizard to configure your wallet and start the node.",
				"Initialize Wallet",
			);
			if (action === "Initialize Wallet") {
				await vscode.commands.executeCommand("cfxdevkit.initializeSetup");
			}
		} else if (ks.locked) {
			const action = await vscode.window.showWarningMessage(
				"Conflux DevKit: Keystore is locked. Unlock it to start the node.",
				"Unlock Wallet",
			);
			if (action === "Unlock Wallet") {
				await vscode.commands.executeCommand("cfxdevkit.unlockKeystore");
			}
		} else {
			// Keystore ready - check if node needs to be started
			const ns = await getNodeStatus();
			if (ns.server === "stopped") {
				const action = await vscode.window.showInformationMessage(
					"Conflux DevKit server is running. Start the local node?",
					"Start Node",
				);
				if (action === "Start Node") {
					await vscode.commands.executeCommand("cfxdevkit.nodeStart");
				}
			}
		}
	} catch {
		// Ignore errors during background check
	}
}
