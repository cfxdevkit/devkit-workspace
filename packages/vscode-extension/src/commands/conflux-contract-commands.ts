import * as vscode from "vscode";
import {
	callDeployedContract,
	getAccounts,
	getCurrentNetwork,
	getDeployedContracts,
	getNetworkCapabilities,
} from "../conflux/api";
import type { AbiFunction } from "../conflux/rpc";
import type { LocalContract } from "../views/contracts";
import { networkState } from "../views/network-state";

/** Shared output channel for contract operations. */
let _contractOutput: vscode.OutputChannel | null = null;

function getContractOutput(): vscode.OutputChannel {
	if (!_contractOutput) {
		_contractOutput = vscode.window.createOutputChannel("Conflux");
	}
	return _contractOutput;
}

type ConfluxProviders = {
	accounts: { load(): Promise<void>; clear(): void };
	contracts: { load(): Promise<void>; clear(): void };
};

function buildArgsPlaceholder(fn: AbiFunction): string {
	if (!fn.inputs.length) return "[]";
	const examples = fn.inputs.map((input) => {
		const type = input.type.toLowerCase();
		if (type.includes("address")) return '"0x..."';
		if (type.includes("bool")) return "true";
		if (type.includes("string")) return '"text"';
		if (type.includes("bytes")) return '"0x"';
		if (type.includes("uint") || type.includes("int"))
			return '"1000000000000000000"';
		if (type.endsWith("[]")) return "[]";
		return "null";
	});
	return `[${examples.join(", ")}]`;
}

async function getSignerForWrite(
	functionName: string,
): Promise<{ accountIndex: number; privateKey?: string } | null> {
	let mode: "local" | "public" = "local";
	try {
		const current = await getCurrentNetwork();
		mode = current.mode;
	} catch {
		mode = networkState.selected === "local" ? "local" : "public";
	}

	if (mode === "local") {
		const accounts = await (async () => {
			try {
				return await getAccounts();
			} catch {
				return [];
			}
		})();

		let accountIndex = 0;
		if (accounts.length > 1) {
			const picks = accounts.map((a, i) => ({
				label: `Account ${i}`,
				description: a.evmAddress,
				detail: `Core: ${a.coreAddress}`,
				index: i,
			}));
			const pick = await vscode.window.showQuickPick(picks, {
				title: `Sign transaction for ${functionName}`,
				placeHolder: "Select signer account",
			});
			if (!pick) return null;
			accountIndex = pick.index;
		}
		return { accountIndex };
	}

	const capabilities = await getNetworkCapabilities().catch(() => null);
	if (capabilities && !capabilities.capabilities.contractWritePublic) {
		vscode.window.showErrorMessage(
			"Public write is not available. Configure network RPC URLs first.",
		);
		return null;
	}

	const source = await vscode.window.showQuickPick(
		[
			{
				label: "Use keystore account index",
				id: "index" as const,
				picked: true,
			},
			{ label: "Override with private key", id: "pk" as const },
		],
		{
			title: `Sign transaction for ${functionName}`,
			placeHolder: "Public mode signer source",
		},
	);
	if (!source) return null;

	if (source.id === "pk") {
		const privateKey = await vscode.window.showInputBox({
			title: "Write private key override",
			prompt: "Optional if server env key override is configured",
			password: true,
			ignoreFocusOut: true,
		});
		if (privateKey === undefined) return null;
		return { accountIndex: 0, privateKey };
	}

	const raw = await vscode.window.showInputBox({
		title: "Signer account index",
		prompt: "Use account index from active keystore mnemonic",
		value: "0",
		validateInput: (v) =>
			/^\d+$/.test(v.trim()) ? null : "Enter a non-negative integer",
		ignoreFocusOut: true,
	});
	if (raw === undefined) return null;
	return { accountIndex: Number(raw) };
}

export function registerContractCommands(params: {
	context: vscode.ExtensionContext;
	providers?: ConfluxProviders;
	requireServerOnline: () => Promise<boolean>;
	ensureBackendNetworkMode: () => Promise<boolean>;
}): void {
	const { context, requireServerOnline, ensureBackendNetworkMode } = params;

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.listContracts", async () => {
			if (!(await requireServerOnline())) return;
			try {
				const contracts = await getDeployedContracts();
				if (!contracts.length) {
					vscode.window
						.showInformationMessage(
							"No contracts deployed yet.",
							"Deploy Contract",
						)
						.then((a) => {
							if (a === "Deploy Contract")
								vscode.commands.executeCommand("cfxdevkit.deployContract");
						});
					return;
				}
				const channel = vscode.window.createOutputChannel(
					"Conflux Deployed Contracts",
					{ log: true },
				);
				channel.clear();
				channel.appendLine("═══ Deployed Contracts ═══\n");
				channel.appendLine(`Network: ${networkState.config.label}\n`);
				for (const c of contracts) {
					channel.appendLine(
						`${(c.name ?? c.id).padEnd(24)} [${c.chain}]  ${c.address}`,
					);
					if (c.deployedAt) channel.appendLine(`  Deployed: ${c.deployedAt}`);
				}
				channel.show(true);
			} catch (err) {
				vscode.window.showErrorMessage(
					`Failed to list contracts: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cfxdevkit.abiCallRead",
			async (fn: AbiFunction, contract: LocalContract) => {
				const output = getContractOutput();
				if (!(await ensureBackendNetworkMode())) return;
				let args: unknown[] = [];
				if (fn.inputs.length > 0) {
					const hint = fn.inputs.map((i) => `${i.name}: ${i.type}`).join(", ");
					const raw = await vscode.window.showInputBox({
						prompt: `Arguments for ${fn.name}(${hint})`,
						placeHolder: `${buildArgsPlaceholder(fn)}  — JSON array, quote big integers`,
						ignoreFocusOut: true,
					});
					if (raw === undefined) return;
					try {
						args = raw.trim() === "" ? [] : (JSON.parse(raw) as unknown[]);
					} catch {
						vscode.window.showErrorMessage(
							'Invalid JSON — expected an array like ["arg1", "arg2"]',
						);
						return;
					}
				}
				try {
					if (!contract.id) {
						vscode.window.showErrorMessage(
							"Contract id missing; cannot call through devkit API.",
						);
						return;
					}
					const result = await callDeployedContract(
						contract.id,
						fn.name,
						args,
						0,
					);
					const ts = new Date().toISOString().slice(11, 23);
					output.appendLine(
						`[${ts}] [READ] ${contract.name ?? contract.address}.${fn.name}(${args.join(", ")})`,
					);
					output.appendLine(`  → ${JSON.stringify(result.result ?? result)}`);
					output.show(true);
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					output.appendLine(
						`[READ] ${contract.name ?? contract.address}.${fn.name} — ERROR: ${errMsg}`,
					);
					output.show(true);
					vscode.window.showErrorMessage(`Read failed: ${errMsg}`);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cfxdevkit.abiCallWrite",
			async (fn: AbiFunction, contract: LocalContract) => {
				const output = getContractOutput();
				if (!(await ensureBackendNetworkMode())) return;
				if (!contract.id) {
					vscode.window.showErrorMessage(
						"Contract id missing; cannot send write transaction.",
					);
					return;
				}
				const signer = await getSignerForWrite(fn.name);
				if (!signer) return;
				let args: unknown[] = [];
				if (fn.inputs.length > 0) {
					const hint = fn.inputs.map((i) => `${i.name}: ${i.type}`).join(", ");
					const raw = await vscode.window.showInputBox({
						prompt: `Arguments for ${fn.name}(${hint})`,
						placeHolder: `${buildArgsPlaceholder(fn)}  — JSON array, quote big integers`,
						ignoreFocusOut: true,
					});
					if (raw === undefined) return;
					try {
						args = raw.trim() === "" ? [] : (JSON.parse(raw) as unknown[]);
					} catch {
						vscode.window.showErrorMessage(
							'Invalid JSON — expected an array like ["arg1", "arg2"]',
						);
						return;
					}
				}
				try {
					const result = await vscode.window.withProgress(
						{
							location: vscode.ProgressLocation.Notification,
							title: `Sending ${fn.name}…`,
							cancellable: false,
						},
						() =>
							callDeployedContract(
								contract.id as string,
								fn.name,
								args,
								signer.accountIndex,
								signer.privateKey,
							),
					);
					const ts = new Date().toISOString().slice(11, 23);
					output.appendLine(
						`[${ts}] [WRITE] ${contract.name ?? contract.address}.${fn.name}(${JSON.stringify(args)})`,
					);
					output.appendLine(`  → tx: ${result.txHash ?? "unknown"}`);
					output.appendLine(`  → status: ${result.status ?? "unknown"}`);
					output.show(true);
					if (result.txHash) {
						vscode.window.showInformationMessage(
							`✅ ${fn.name} → ${result.txHash.substring(0, 18)}…`,
						);
					} else {
						vscode.window.showInformationMessage(
							`✅ ${fn.name} transaction sent`,
						);
					}
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					output.appendLine(
						`[WRITE] ${contract.name ?? contract.address}.${fn.name} — ERROR: ${errMsg}`,
					);
					output.show(true);
					vscode.window.showErrorMessage(`Write failed: ${errMsg}`);
				}
			},
		),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cfxdevkit.copyContractAddress",
			async (item: { address?: string }) => {
				const addr = item?.address;
				if (!addr) return;
				await vscode.env.clipboard.writeText(addr);
				vscode.window.showInformationMessage(`Copied: ${addr}`);
			},
		),
	);
}
