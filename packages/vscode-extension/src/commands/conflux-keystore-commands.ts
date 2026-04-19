import * as vscode from "vscode";
import {
	generateMnemonic,
	getKeystoreStatus,
	setupKeystoreWallet,
	unlockKeystoreWallet,
} from "../conflux/api";

export function registerKeystoreLifecycleCommands(params: {
	context: vscode.ExtensionContext;
	requireServerOnline: () => Promise<boolean>;
}): void {
	const { context, requireServerOnline } = params;

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.initializeSetup", async () => {
			if (!(await requireServerOnline())) return;

			try {
				const ks = await getKeystoreStatus();
				if (ks.initialized) {
					const action = await vscode.window.showInformationMessage(
						`Keystore is already initialized${ks.locked ? " (locked)." : "."}`,
						ks.locked ? "Unlock" : "Start Node",
					);
					if (action === "Unlock")
						vscode.commands.executeCommand("cfxdevkit.unlockKeystore");
					else if (action === "Start Node")
						vscode.commands.executeCommand("cfxdevkit.nodeStart");
					return;
				}

				const source = await vscode.window.showQuickPick(
					[
						{
							label: "$(sparkle) Generate new mnemonic",
							description:
								"12 BIP-39 words — creates a fresh development wallet",
							value: "generate" as const,
						},
						{
							label: "$(sign-in) Import existing mnemonic",
							description: "Paste your own BIP-39 phrase (12 or 24 words)",
							value: "import" as const,
						},
					],
					{
						title: "Conflux: Initialize Wallet (Step 1 of 3)",
						placeHolder: "How do you want to set up your wallet?",
					},
				);
				if (!source) return;

				const label = await vscode.window.showInputBox({
					title: "Conflux: Initialize Wallet (Step 2 of 3) — Wallet Label",
					prompt: "Enter a label for this wallet",
					value: "Default",
					placeHolder: "Default",
				});
				if (label === undefined) return;

				let mnemonic: string;
				if (source.value === "import") {
					const input = await vscode.window.showInputBox({
						title: "Conflux: Initialize Wallet (Step 3 of 3) — Import Mnemonic",
						prompt: "Enter your 12 or 24-word BIP-39 mnemonic phrase",
						placeHolder: "word1 word2 word3 …",
						ignoreFocusOut: true,
						validateInput: (v) => {
							const words = v.trim().split(/\s+/).filter(Boolean);
							if (words.length !== 12 && words.length !== 24) {
								return `Mnemonic must be 12 or 24 words (got ${words.length})`;
							}
							return null;
						},
					});
					if (!input) return;
					mnemonic = input.trim();
				} else {
					try {
						mnemonic = await vscode.window.withProgress(
							{
								location: vscode.ProgressLocation.Notification,
								title: "Generating mnemonic…",
								cancellable: false,
							},
							() => generateMnemonic(),
						);
					} catch (err) {
						vscode.window.showErrorMessage(
							`Failed to generate mnemonic: ${err instanceof Error ? err.message : String(err)}`,
						);
						return;
					}
				}

				if (source.value === "generate") {
					const channel = vscode.window.createOutputChannel(
						"Conflux Wallet Setup",
					);
					channel.clear();
					channel.appendLine("═══════════════════════════════════════════════");
					channel.appendLine("  CONFLUX DEVKIT — WALLET MNEMONIC");
					channel.appendLine("  SAVE THIS PHRASE. It cannot be recovered.");
					channel.appendLine("═══════════════════════════════════════════════");
					channel.appendLine("");
					channel.appendLine(mnemonic);
					channel.appendLine("");
					channel.appendLine("═══════════════════════════════════════════════");
					channel.show(true);

					const proceed = await vscode.window.showWarningMessage(
						"⚠️ Save your mnemonic phrase! It is shown in the Output panel.",
						{ modal: true },
						"I have saved it — Continue",
					);
					if (proceed !== "I have saved it — Continue") return;
				}

				const configuredAccounts = vscode.workspace
					.getConfiguration("cfxdevkit")
					.get<number>("accountsCount", 5);
				const accountsCount =
					Number.isInteger(configuredAccounts) && (configuredAccounts ?? 0) > 0
						? (configuredAccounts as number)
						: 5;

				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: "Initializing keystore…",
						cancellable: false,
					},
					() =>
						setupKeystoreWallet(mnemonic, label || "Default", {
							accountsCount,
						}),
				);

				const startNow = await vscode.window.showInformationMessage(
					`✅ Wallet "${label || "Default"}" initialized! Start the Conflux node now?`,
					"Start Node",
					"Later",
				);
				if (startNow === "Start Node") {
					vscode.commands.executeCommand("cfxdevkit.nodeStart");
				}
			} catch (err) {
				vscode.window.showErrorMessage(
					`Setup failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.unlockKeystore", async () => {
			if (!(await requireServerOnline())) return;
			const password = await vscode.window.showInputBox({
				title: "Conflux: Unlock Keystore",
				prompt: "Enter your keystore password",
				password: true,
			});
			if (password === undefined) return;
			try {
				await unlockKeystoreWallet(password);
				const action = await vscode.window.showInformationMessage(
					"Keystore unlocked. Start the Conflux node?",
					"Start Node",
				);
				if (action === "Start Node") {
					vscode.commands.executeCommand("cfxdevkit.nodeStart");
				}
			} catch (err) {
				vscode.window.showErrorMessage(
					`Unlock failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);
}
