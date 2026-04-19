import * as vscode from "vscode";
import { registerDeployedContract } from "../conflux/api";
import { NETWORK_CONFIGS } from "../views/network-state";

type ConfluxProviders = {
	accounts: { load(): Promise<void>; clear(): void };
	contracts: { load(): Promise<void>; clear(): void };
};

export function registerImportCommands(params: {
	context: vscode.ExtensionContext;
	providers?: ConfluxProviders;
	requireServerOnline: () => Promise<boolean>;
}): void {
	const { context, providers, requireServerOnline } = params;

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.importContract", async () => {
			if (!(await requireServerOnline())) return;

			const source = await vscode.window.showQuickPick(
				[
					{ label: "Manual input", value: "manual" as const },
					{ label: "From environment variable", value: "env" as const },
				],
				{
					title: "Import Contract (Step 1 of 6) — Address Source",
					placeHolder: "Choose contract address source",
				},
			);
			if (!source) return;

			let address = "";
			if (source.value === "env") {
				const envVar = await vscode.window.showInputBox({
					title: "Import Contract (Step 2 of 6) — Environment Variable",
					prompt: "Enter env var name containing contract address",
					value: "CONTRACT_ADDRESS",
					validateInput: (v) => (v.trim() ? null : "Env var name is required"),
				});
				if (!envVar) return;
				const value = process.env[envVar.trim()];
				if (!value) {
					vscode.window.showErrorMessage(
						`Environment variable ${envVar.trim()} is not set.`,
					);
					return;
				}
				address = value.trim();
			} else {
				const input = await vscode.window.showInputBox({
					title: "Import Contract (Step 2 of 6) — Contract Address",
					prompt: "Enter Core or eSpace contract address",
					placeHolder: "0x... or cfx:.../cfxtest:.../net...:",
					validateInput: (v) => (v.trim() ? null : "Address is required"),
				});
				if (!input) return;
				address = input.trim();
			}

			const chainDefault: "evm" | "core" = address
				.toLowerCase()
				.startsWith("0x")
				? "evm"
				: "core";
			const chainPick = await vscode.window.showQuickPick(
				[
					{ label: "eSpace (EVM)", id: "evm" as const },
					{ label: "Core Space", id: "core" as const },
				],
				{
					title: "Import Contract (Step 3 of 6) — Chain",
					placeHolder: "Select chain for this contract",
				},
			);
			if (!chainPick) return;

			const networkPick = await vscode.window.showQuickPick(
				[
					{ label: "Local", id: "local" as const },
					{ label: "Testnet", id: "testnet" as const },
					{ label: "Mainnet", id: "mainnet" as const },
					{ label: "Custom chain id", id: "custom" as const },
				],
				{
					title: "Import Contract (Step 4 of 6) — Network",
					placeHolder: "Select deployment network for grouping",
				},
			);
			if (!networkPick) return;

			let chainId: number;
			let networkLabel: string;
			if (networkPick.id === "custom") {
				const rawChainId = await vscode.window.showInputBox({
					title: "Custom chain id",
					prompt: "Enter numeric chain id",
					validateInput: (v) =>
						/^\d+$/.test(v.trim()) ? null : "Enter a positive integer",
				});
				if (!rawChainId) return;
				chainId = Number(rawChainId.trim());
				networkLabel = `chain-${chainId}`;
			} else {
				networkLabel = networkPick.id;
				const cfg = NETWORK_CONFIGS[networkPick.id];
				chainId = chainPick.id === "evm" ? cfg.espaceChainId : cfg.coreChainId;
			}

			if (chainPick.id !== chainDefault) {
				const keep = await vscode.window.showWarningMessage(
					`Address format suggests ${chainDefault === "evm" ? "eSpace" : "Core"}, but you selected ${chainPick.id === "evm" ? "eSpace" : "Core"}. Continue?`,
					"Continue",
					"Cancel",
				);
				if (keep !== "Continue") return;
			}

			const name = await vscode.window.showInputBox({
				title: "Import Contract (Step 5 of 6) — Contract Name",
				prompt: "Name used in contracts tree and tracking",
				value: "ImportedContract",
				validateInput: (v) => (v.trim() ? null : "Name is required"),
			});
			if (!name) return;

			const txHash = await vscode.window.showInputBox({
				title: "Import Contract (Step 6 of 6) — Transaction Hash (optional)",
				prompt: "Leave empty if unknown",
			});

			try {
				await registerDeployedContract({
					name: name.trim(),
					address,
					chain: chainPick.id,
					chainId,
					txHash: txHash?.trim() || "",
					metadata: {
						source: source.value === "env" ? "import-env" : "import-manual",
						mode: networkLabel === "local" ? "local" : "public",
						network: networkLabel,
					},
				});
				providers?.contracts.load();
				vscode.window
					.showInformationMessage(
						`✅ Imported ${name.trim()} on ${networkLabel} (${chainPick.id}).`,
						"List Contracts",
					)
					.then((a) => {
						if (a === "List Contracts")
							vscode.commands.executeCommand("cfxdevkit.listContracts");
					});
			} catch (err) {
				const action = await vscode.window.showErrorMessage(
					`Contract import failed: ${err instanceof Error ? err.message : String(err)}`,
					"Retry",
					"Show Logs",
				);
				if (action === "Retry")
					vscode.commands.executeCommand("cfxdevkit.importContract");
			}
		}),
	);
}
