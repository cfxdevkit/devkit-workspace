import * as vscode from "vscode";
import {
	compileContract,
	deployTemplate,
	dexStream,
	getAccounts,
	getBootstrapCatalog,
	getBootstrapEntry,
	getContractTemplates,
	getCurrentNetwork,
} from "../conflux/api";
import { workspaceUri } from "../utils/fs";
import { networkState } from "../views/network-state";
import { pickDexSeedPools, pickDexSeedStablecoins } from "./dex-seed-pickers";

/** Shared output channel for DEX deploy/seed operations. */
let _dexOutputChannel: vscode.OutputChannel | null = null;

/** Last seed args — stored so "Retry Seed Only" can replay the same selection. */
let _lastSeedArgs: Record<string, unknown> | null = null;

function getDexOutputChannel(): vscode.OutputChannel {
	if (!_dexOutputChannel) {
		_dexOutputChannel = vscode.window.createOutputChannel("DEX Deploy");
	}
	return _dexOutputChannel;
}

function dexLog(message: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	getDexOutputChannel().appendLine(`[${ts}] ${message}`);
}

type ConfluxProviders = {
	accounts: { load(): Promise<void>; clear(): void };
	contracts: { load(): Promise<void>; clear(): void };
};

function argDefault(
	placeholder: string | undefined,
	defaultAddr: string,
): string {
	if (!placeholder) return "";
	// Replace 0x... / 0xabc... patterns with the actual genesis account 0 address
	if (/^0x[….]/.test(placeholder) || /^0x[a-fA-F0-9]{3}…/.test(placeholder)) {
		return defaultAddr;
	}
	// Comma-separated address lists -> fill with default address
	if (/^0x[a-fA-F0-9]{3}.*,\s*0x/.test(placeholder)) {
		return defaultAddr;
	}
	return placeholder;
}

export function registerDeployCommands(params: {
	context: vscode.ExtensionContext;
	providers?: ConfluxProviders;
	requireServerOnline: () => Promise<boolean>;
	ensureBackendNetworkMode: () => Promise<boolean>;
}): void {
	const { context, providers, requireServerOnline, ensureBackendNetworkMode } =
		params;

	async function getDefaultAddress(): Promise<string> {
		try {
			const accounts = await getAccounts();
			return accounts[0]?.evmAddress ?? "";
		} catch {
			return "";
		}
	}

	async function getDeploySignerOptions(): Promise<{
		accountIndex?: number;
		privateKey?: string;
	} | null> {
		let mode: "local" | "public" = "local";
		try {
			const current = await getCurrentNetwork();
			mode = current.mode;
		} catch {
			mode = networkState.selected === "local" ? "local" : "public";
		}

		if (mode === "local") return { accountIndex: 0 };

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
				title: "Public deploy signer",
				placeHolder: "Server env key override still has highest priority",
			},
		);
		if (!source) return null;

		if (source.id === "pk") {
			const privateKey = await vscode.window.showInputBox({
				title: "Private key override",
				prompt: "Enter 0x private key (optional if server env override is set)",
				password: true,
				ignoreFocusOut: true,
			});
			if (privateKey === undefined) return null;
			return { privateKey };
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

	async function deployFromBootstrap(): Promise<void> {
		let catalog: Awaited<ReturnType<typeof getBootstrapCatalog>>;
		try {
			catalog = await getBootstrapCatalog();
		} catch (err) {
			vscode.window.showErrorMessage(
				`Failed to load catalog: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}
		const deployable = catalog.filter((e) => e.type !== "precompile");
		if (!deployable.length) {
			vscode.window.showErrorMessage(
				"No deployable contracts in catalog. Is the node running?",
			);
			return;
		}

		const picked = await vscode.window.showQuickPick(
			deployable.map((e) => ({
				label: e.name,
				detail: `[${e.category}] ${e.description}`,
				entry: e,
			})),
			{ title: "Bootstrap Catalog", placeHolder: "Select a contract…" },
		);
		if (!picked) return;

		const chainPick = await vscode.window.showQuickPick(
			[
				{
					label: "eSpace (EVM-compatible)",
					detail: "chainId: 2030  ← recommended",
					id: "evm" as const,
					picked: true,
				},
				{ label: "Core Space", detail: "chainId: 2029", id: "core" as const },
			],
			{
				title: `Deploy ${picked.label}`,
				placeHolder: "Select target chain (default: eSpace)…",
			},
		);
		if (!chainPick) return;

		if (!(await ensureBackendNetworkMode())) return;

		const signer = await getDeploySignerOptions();
		if (signer === null) return;

		let entry = picked.entry;
		try {
			entry = await getBootstrapEntry(picked.label);
		} catch (err) {
			vscode.window.showErrorMessage(
				`Failed to load bootstrap artifact: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}
		if (!entry.abi || !entry.bytecode) {
			vscode.window.showErrorMessage(
				"Selected bootstrap contract has no deployable bytecode/ABI.",
			);
			return;
		}

		const args: unknown[] = [];
		const constructorArgs = picked.entry.constructorArgs ?? [];
		if (constructorArgs.length > 0) {
			const defaultAddr = await getDefaultAddress();
			for (const arg of constructorArgs) {
				const defaultVal = argDefault(arg.placeholder, defaultAddr);
				const val = await vscode.window.showInputBox({
					title: `${picked.label} — ${arg.name}`,
					prompt: `${arg.description ?? arg.type}${defaultVal ? "" : " (required)"}`,
					value: defaultVal,
					placeHolder: arg.type,
				});
				if (val === undefined) return;
				args.push(val);
			}
		}

		try {
			const contract = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Deploying ${picked.label}…`,
					cancellable: false,
				},
				() =>
					deployTemplate(
						picked.label,
						entry.abi as unknown[],
						entry.bytecode as string,
						args,
						chainPick.id,
						signer,
					),
			);
			providers?.contracts.load();
			vscode.window
				.showInformationMessage(
					`✅ ${picked.label} deployed at ${contract.address}`,
					"List Contracts",
				)
				.then((a) => {
					if (a === "List Contracts")
						vscode.commands.executeCommand("cfxdevkit.listContracts");
				});
		} catch (err) {
			vscode.window.showErrorMessage(
				`Deployment failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	async function deployFromTemplate(): Promise<void> {
		let templates: Awaited<ReturnType<typeof getContractTemplates>>;
		try {
			templates = await getContractTemplates();
		} catch (err) {
			vscode.window.showErrorMessage(
				`Failed to load templates: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}
		if (!templates.length) {
			vscode.window.showErrorMessage(
				"No templates available. Is the node running?",
			);
			return;
		}

		const picked = await vscode.window.showQuickPick(
			templates.map((t) => ({
				label: t.name,
				detail: t.description,
				source: t.source,
			})),
			{ title: "Dev Templates", placeHolder: "Select a template…" },
		);
		if (!picked) return;

		let compiled: Awaited<ReturnType<typeof compileContract>>;
		try {
			compiled = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Compiling ${picked.label}…`,
					cancellable: false,
				},
				() => compileContract(picked.source ?? "", picked.label),
			);
		} catch (err) {
			vscode.window.showErrorMessage(
				`Compilation failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			return;
		}

		const chainPick = await vscode.window.showQuickPick(
			[
				{
					label: "eSpace (EVM-compatible)",
					detail: "chainId: 2030  ← recommended",
					id: "evm" as const,
					picked: true,
				},
				{ label: "Core Space", detail: "chainId: 2029", id: "core" as const },
			],
			{
				title: `Deploy ${picked.label}`,
				placeHolder: "Select target chain (default: eSpace)…",
			},
		);
		if (!chainPick) return;

		if (!(await ensureBackendNetworkMode())) return;

		const signer = await getDeploySignerOptions();
		if (signer === null) return;

		const ctorAbi = (
			compiled.abi as Array<{
				type?: string;
				inputs?: Array<{ name: string; type: string }>;
			}>
		).find((e) => e.type === "constructor");
		const ctorInputs = ctorAbi?.inputs ?? [];
		const args: unknown[] = [];

		if (ctorInputs.length > 0) {
			const defaultAddr = await getDefaultAddress();
			for (const input of ctorInputs) {
				const isAddr = input.type === "address";
				const val = await vscode.window.showInputBox({
					title: `${picked.label} — ${input.name}`,
					prompt: `${input.type}${isAddr ? " (address)" : ""}`,
					value: isAddr ? defaultAddr : "",
					placeHolder: input.type,
				});
				if (val === undefined) return;
				args.push(val);
			}
		}

		try {
			const contract = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: `Deploying ${picked.label}…`,
					cancellable: false,
				},
				() =>
					deployTemplate(
						picked.label,
						compiled.abi,
						compiled.bytecode,
						args,
						chainPick.id,
						signer,
					),
			);
			providers?.contracts.load();
			vscode.window
				.showInformationMessage(
					`✅ ${picked.label} deployed to ${chainPick.id} at ${contract.address}`,
					"List Contracts",
				)
				.then((a) => {
					if (a === "List Contracts")
						vscode.commands.executeCommand("cfxdevkit.listContracts");
				});
		} catch (err) {
			vscode.window.showErrorMessage(
				`Deployment failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	async function deployDexStack(): Promise<void> {
		const dexAction = await vscode.window.showQuickPick(
			[
				{
					label: "🚀 Deploy V2 Stack",
					detail: "Deploy Factory + WETH9 + Router02 to eSpace",
					id: "deploy" as const,
				},
				{
					label: "🌊 Seed Pools",
					detail:
						"Import selected source pools from the known-token catalog and create local liquidity pairs",
					id: "seed" as const,
				},
				{
					label: "📦 Deploy + Seed (Full Setup)",
					detail: "Deploy V2 stack then seed from the pool preset selection",
					id: "full" as const,
				},
			],
			{ title: "DEX: Uniswap V2", placeHolder: "Choose DEX action…" },
		);
		if (!dexAction) return;

		const workspaceRoot = workspaceUri().fsPath;
		let selectedPoolAddresses: string[] | null = null;
		let selectedStablecoins: string[] | undefined;
		if (dexAction.id === "seed" || dexAction.id === "full") {
			const stableSelection = await pickDexSeedStablecoins();
			if (stableSelection === undefined) return;
			selectedStablecoins = stableSelection;

			const poolSelection = await pickDexSeedPools({
				workspaceRoot,
				extensionPath: context.extensionPath,
			});
			if (poolSelection === undefined) return;
			selectedPoolAddresses = poolSelection;
		}

		const steps: string[] = [];
		if (dexAction.id === "deploy" || dexAction.id === "full") {
			steps.push("deploy");
		}
		if (dexAction.id === "seed" || dexAction.id === "full") {
			steps.push("seed");
		}

		// Defined outside withProgress so closures can reference it after the spinner dismisses
		const channel = getDexOutputChannel();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		let afterProgress: () => Promise<void> = async () => {};

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "DEX",
				cancellable: false,
			},
			async (progress) => {
				channel.show(true);

				let deployOk = false;
				let seedOk = false;

				try {
					if (steps.includes("deploy")) {
						progress.report({
							message: "Deploying V2 stack (Factory + WETH9 + Router02)…",
						});
						dexLog("─── Deploying Uniswap V2 Stack ───");
						dexLog("");
						const deployText = await dexStream(
							"/api/dex/deploy-stream",
							{},
							(line) => {
								dexLog(line);
								progress.report({ message: line });
							},
						);
						for (const line of deployText.split("\n")) {
							dexLog(line);
						}
						deployOk = true;
						dexLog("");
					}

					if (steps.includes("seed")) {
						const poolCount = selectedPoolAddresses?.length ?? 0;
						const stableCount = selectedStablecoins?.length ?? 0;
						progress.report({
							message: `Seeding ${poolCount} pools + ${stableCount} stablecoins…`,
						});
						dexLog(
							`─── Seeding DEX: ${poolCount} pool(s), ${stableCount} stablecoin(s) ───`,
						);
						dexLog("");
						const seedArgs: Record<string, unknown> = {};
						if (selectedPoolAddresses && selectedPoolAddresses.length > 0) {
							seedArgs.selectedPoolAddresses = selectedPoolAddresses;
						}
						if (selectedStablecoins && selectedStablecoins.length > 0) {
							seedArgs.selectedStablecoins = selectedStablecoins;
						}
						// Store for potential retry
						_lastSeedArgs = { ...seedArgs };
						const seedText = await dexStream(
							"/api/dex/seed-stream",
							seedArgs,
							(line) => {
								dexLog(line);
								progress.report({ message: line });
							},
						);
						for (const line of seedText.split("\n")) {
							dexLog(line);
						}
						seedOk = true;
						progress.report({ message: "✅ Complete" });
						dexLog("");
					}

					providers?.contracts.load();
					dexLog("─── Done ───");
					dexLog("");

					const successMsg =
						deployOk && seedOk
							? "✅ DEX deployed and seeded"
							: deployOk
								? "✅ DEX deployed"
								: "✅ DEX seeded";

					// Defer the notification until AFTER withProgress resolves (spinner dismisses first)
					afterProgress = async () => {
						const action = await vscode.window.showInformationMessage(
							successMsg,
							"Start DEX UI",
							"Show Logs",
						);
						if (action === "Start DEX UI")
							vscode.commands.executeCommand("cfxdevkit.dexUiStart");
						if (action === "Show Logs") channel.show(true);
					};
				} catch (err) {
					const rawMsg = err instanceof Error ? err.message : String(err);
					let userMsg = rawMsg;
					if (rawMsg.includes("429")) {
						userMsg =
							"Rate-limited by GeckoTerminal. Retry in a moment — pool data is cached locally.";
					} else if (rawMsg.includes("Failed to fund")) {
						userMsg =
							"Funding failed. The local node may need more time to mine. Retry should succeed.";
					} else if (rawMsg.length > 120) {
						userMsg = `${rawMsg.slice(0, 120)}…`;
					}

					dexLog("");
					dexLog(`─── Error ───`);
					dexLog(rawMsg);
					dexLog("");

					const actions = deployOk
						? ["Show Logs", "Retry Seed Only", "Retry All"]
						: ["Show Logs", "Retry"];

					// Defer error notification until after the spinner dismisses
					afterProgress = async () => {
						const action = await vscode.window.showErrorMessage(
							`DEX failed: ${userMsg}`,
							...actions,
						);
						if (action === "Show Logs") channel.show(true);
						if (action === "Retry" || action === "Retry All")
							vscode.commands.executeCommand("cfxdevkit.deployDex");
						if (action === "Retry Seed Only")
							vscode.commands.executeCommand("cfxdevkit.dexRetrySeedOnly");
					};
				}
			},
		);

		// Spinner is now dismissed — show the result notification
		await afterProgress();
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.deployContract", async () => {
			if (!(await requireServerOnline())) return;

			const source = await vscode.window.showQuickPick(
				[
					{
						label: "📦 Bootstrap Catalog",
						detail: "Production-ready contracts: ERC20, NFT, MultiSig, DeFi…",
						id: "bootstrap" as const,
					},
					{
						label: "🔧 Dev Template",
						detail: "Simple dev contracts: Counter, SimpleStorage, TestToken…",
						id: "template" as const,
					},
					{
						label: "🔄 DEX (Uniswap V2)",
						detail:
							"Deploy full V2 stack: Factory + WETH9 + Router + seed pools",
						id: "dex" as const,
					},
				],
				{
					title: "Conflux: Deploy Contract",
					placeHolder: "Choose contract source…",
				},
			);
			if (!source) return;

			if (source.id === "bootstrap") {
				await deployFromBootstrap();
			} else if (source.id === "dex") {
				await deployDexStack();
			} else {
				await deployFromTemplate();
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.deployDex", async () => {
			if (!(await requireServerOnline())) return;
			await deployDexStack();
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.dexRetrySeedOnly", async () => {
			if (!(await requireServerOnline())) return;
			// If no stored args, fall back to the full flow
			if (!_lastSeedArgs) {
				await deployDexStack();
				return;
			}
			const seedArgs = { ..._lastSeedArgs };
			const channel = getDexOutputChannel();
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			let afterSeedProgress: () => Promise<void> = async () => {};

			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: "DEX Seed (retry)",
					cancellable: false,
				},
				async (progress) => {
					channel.show(true);
					dexLog("─── Retry Seed Only ───");
					dexLog("");
					try {
						const seedText = await dexStream(
							"/api/dex/seed-stream",
							seedArgs,
							(line) => {
								dexLog(line);
								progress.report({ message: line });
							},
						);
						for (const line of seedText.split("\n")) dexLog(line);
						providers?.contracts.load();
						dexLog("");
						dexLog("─── Done ───");
						afterSeedProgress = async () => {
							const action = await vscode.window.showInformationMessage(
								"✅ DEX seeded",
								"Start DEX UI",
								"Show Logs",
							);
							if (action === "Start DEX UI")
								vscode.commands.executeCommand("cfxdevkit.dexUiStart");
							if (action === "Show Logs") channel.show(true);
						};
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						dexLog("");
						dexLog("─── Error ───");
						dexLog(msg);
						afterSeedProgress = async () => {
							const action = await vscode.window.showErrorMessage(
								`Seed failed: ${msg.length > 120 ? `${msg.slice(0, 120)}…` : msg}`,
								"Show Logs",
								"Retry",
							);
							if (action === "Show Logs") channel.show(true);
							if (action === "Retry")
								vscode.commands.executeCommand("cfxdevkit.dexRetrySeedOnly");
						};
					}
				},
			);

			// Spinner dismissed — show the result notification
			await afterSeedProgress();
		}),
	);
}
