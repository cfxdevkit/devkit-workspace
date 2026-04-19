/**
 * statusbar.ts
 *
 * Project status bar — script-driven frontend for project lifecycle operations.
 *
 * Goals:
 * - One unified Project menu
 * - Strict package.json script contract (no internal docker-compose fallback)
 * - Independent lifecycles for contracts / dev / production
 * - Degraded health mode (warnings do not block all actions)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getDeployedContracts } from "./conflux/api";
import {
	isManagedProcessRunning,
	openManagedProcessLogs,
	startManagedProcess,
	stopManagedProcess,
} from "./utils/persistent-process";
import { networkState } from "./views/network-state";
import { nodeRunningState } from "./views/node-state";

const POLL_INTERVAL_MS = 20_000;
const DEV_PROCESS_ID = "project-dev-server";
const PROD_PROCESS_ID = "project-prod-server";

type ProjectState =
	| "setup-needed"
	| "idle"
	| "dev"
	| "prod"
	| "dev+prod"
	| "degraded";

type DoctorLevel = "ok" | "warn" | "error";

interface DoctorCheck {
	key: string;
	level: DoctorLevel;
	message: string;
}

interface DoctorReport {
	checks: DoctorCheck[];
	warnCount: number;
	errorCount: number;
	checkedAt: string;
}

function getWorkspaceCwd(): string | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function cfg<T>(key: string, def: T): T {
	return vscode.workspace.getConfiguration("devkit").get<T>(key) ?? def;
}

function hasNodeModules(cwd: string): boolean {
	return fs.existsSync(path.join(cwd, "node_modules"));
}

function readPackageScripts(cwd: string): Record<string, string> {
	try {
		const pkgPath = path.join(cwd, "package.json");
		if (!fs.existsSync(pkgPath)) return {};
		const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
			scripts?: Record<string, string>;
		};
		return pkg.scripts ?? {};
	} catch {
		return {};
	}
}

function hasScript(scripts: Record<string, string>, name: string): boolean {
	return !!name && !!scripts[name];
}

function scriptRunnerCommand(scriptName: string): string {
	const pm = (cfg<string>("packageManager", "pnpm") || "pnpm").trim();
	if (pm === "yarn") return `yarn ${scriptName}`;
	if (pm === "npm") return `npm run ${scriptName}`;
	return `pnpm run ${scriptName}`;
}

function runScriptInTerminal(
	label: string,
	cwd: string,
	scriptName: string,
): void {
	const term = vscode.window.createTerminal({ name: label, cwd });
	term.show();
	term.sendText(scriptRunnerCommand(scriptName));
}

function runScriptWithEnvInTerminal(
	label: string,
	cwd: string,
	scriptName: string,
	env: Record<string, string>,
): void {
	const term = vscode.window.createTerminal({ name: label, cwd });
	term.show();
	const envStr = Object.entries(env)
		.map(([k, v]) => `${k}=${JSON.stringify(v)}`)
		.join(" ");
	term.sendText(`${envStr} ${scriptRunnerCommand(scriptName)}`);
}

async function runManagedScript(
	processId: string,
	label: string,
	cwd: string,
	scriptName: string,
	env?: Record<string, string>,
): Promise<void> {
	if (isManagedProcessRunning(processId)) return;
	await startManagedProcess({
		id: processId,
		label,
		cwd,
		command: scriptRunnerCommand(scriptName),
		env,
	});
}

function getProjectNetworkEnv(): Record<string, string> {
	return {
		DEVKIT_NETWORK: networkState.selected,
		DEPLOY_CHAIN_ID: networkState.config.espaceChainId.toString(),
		DEPLOY_RPC_URL: getSelectedEspaceRpc(),
		DEPLOY_NETWORK: networkState.selected,
		PROJECT_CHAIN_ID: networkState.config.espaceChainId.toString(),
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServiceReady(
	title: string,
	port: number,
	check: () => Promise<boolean>,
	timeoutMs = 60_000,
): Promise<boolean> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title,
			cancellable: false,
		},
		async (progress) => {
			const deadline = Date.now() + timeoutMs;
			let attempts = 0;

			progress.report({
				message: `Launch command sent. Waiting for port ${port}...`,
			});

			while (Date.now() < deadline) {
				attempts += 1;
				if (await check()) {
					progress.report({ increment: 100, message: "Service is ready." });
					return true;
				}

				progress.report({
					increment: 5,
					message: `Still starting... (${attempts * 2}s elapsed)`,
				});
				await delay(2_000);
			}

			progress.report({
				increment: 100,
				message: "Timed out waiting for the service.",
			});
			return false;
		},
	);
}

async function isDevServerRunning(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/`, {
			signal: AbortSignal.timeout(2_000),
		});
		return r.status < 500;
	} catch {
		return false;
	}
}

async function isProdServerRunning(port: number): Promise<boolean> {
	try {
		const r = await fetch(`http://127.0.0.1:${port}/`, {
			signal: AbortSignal.timeout(2_000),
		});
		return r.status < 500;
	} catch {
		return false;
	}
}

function getSelectedEspaceRpc(): string {
	if (networkState.selected === "local") {
		return (
			vscode.workspace.getConfiguration("cfxdevkit").get<string>("espaceRpc") ??
			networkState.config.espaceRpc
		);
	}
	return networkState.config.espaceRpc;
}

async function isSelectedNetworkReachable(): Promise<boolean> {
	try {
		const rpcUrl = getSelectedEspaceRpc();
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "eth_chainId",
				params: [],
			}),
			signal: AbortSignal.timeout(3_000),
		});
		const json = (await res.json()) as {
			result?: string;
			error?: { message?: string };
		};
		return !!json.result && !json.error;
	} catch {
		return false;
	}
}

function getContractsArtifactPath(cwd: string): string {
	const artifactRel = cfg<string>(
		"contractsArtifactPath",
		".generated/project-example/dapp/src/generated/contracts-addresses.ts",
	);
	const candidates = resolvePathCandidates(cwd, artifactRel);
	const found = candidates.find((p) => fs.existsSync(p));
	return found ?? candidates[0];
}

function getFrontendContractFilePath(cwd: string): string {
	const rel =
		".generated/project-example/dapp/src/components/ExampleContract.tsx";
	const candidates = resolvePathCandidates(cwd, rel);
	const found = candidates.find((p) => fs.existsSync(p));
	return found ?? candidates[0];
}

function resolvePathCandidates(cwd: string, configuredRel: string): string[] {
	const normalized = configuredRel.replace(/^\.\//, "");
	const candidates = new Set<string>();

	// As configured (typically monorepo root relative)
	candidates.add(path.join(cwd, normalized));

	// If workspace is already inside the generated project, strip its prefix.
	if (normalized.startsWith(".generated/project-example/")) {
		candidates.add(
			path.join(cwd, normalized.replace(/^\.generated\/project-example\//, "")),
		);
	}

	// If workspace is monorepo root and config is generated-project-relative missing, prefix it.
	if (
		!normalized.startsWith(".generated/project-example/") &&
		fs.existsSync(path.join(cwd, ".generated", "project-example"))
	) {
		candidates.add(path.join(cwd, ".generated", "project-example", normalized));
	}

	// Known default fallbacks used by the generated project workspace.
	candidates.add(path.join(cwd, "dapp/src/generated/contracts-addresses.ts"));
	candidates.add(
		path.join(
			cwd,
			".generated/project-example/dapp/src/generated/contracts-addresses.ts",
		),
	);

	return Array.from(candidates);
}

async function ethGetCode(
	rpcUrl: string,
	address: string,
): Promise<string | null> {
	try {
		const res = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "eth_getCode",
				params: [address, "latest"],
			}),
			signal: AbortSignal.timeout(4_000),
		});
		const json = (await res.json()) as {
			result?: string;
			error?: { message?: string };
		};
		if (json.error) return null;
		return json.result ?? null;
	} catch {
		return null;
	}
}

function extractAddressesForChain(tsSource: string, chainId: number): string[] {
	const block =
		new RegExp(`['"]?${chainId}['"]?\\s*:\\s*\\{([\\s\\S]*?)\\}`, "m").exec(
			tsSource,
		)?.[1] ?? "";
	if (!block) return [];
	const matches = block.match(/0x[a-fA-F0-9]{40}/g) ?? [];
	return Array.from(new Set(matches));
}

async function runProjectDoctor(cwd: string): Promise<DoctorReport> {
	const checks: DoctorCheck[] = [];
	const scripts = readPackageScripts(cwd);

	const scriptDoctor = cfg<string>("scriptDoctor", "doctor").trim();
	const scriptInstall = cfg<string>("scriptInstall", "").trim();
	const scriptDeploy = cfg<string>("scriptContractsDeploy", "").trim();
	const scriptClean = cfg<string>("scriptClean", "clean").trim();
	const scriptDevStart = cfg<string>("scriptDevStart", "").trim();
	const scriptDevStop = cfg<string>("scriptDevStop", "").trim();
	const scriptProdStart = cfg<string>("scriptProdStart", "stack:up").trim();
	const scriptProdStop = cfg<string>("scriptProdStop", "stack:down").trim();
	const scriptProdRebuild = cfg<string>(
		"scriptProdRebuild",
		"stack:rebuild",
	).trim();
	const scriptProdStatus = cfg<string>(
		"scriptProdStatus",
		"stack:status",
	).trim();
	const scriptProdLogs = cfg<string>("scriptProdLogs", "").trim();

	checks.push(
		hasNodeModules(cwd)
			? {
					key: "deps.installed",
					level: "ok",
					message: "Dependencies: node_modules present",
				}
			: {
					key: "deps.installed",
					level: "warn",
					message: "Dependencies missing: run install script",
				},
	);

	const scriptChecks: Array<[string, string, boolean]> = [
		["script.doctor", scriptDoctor, true],
		["script.install", scriptInstall, true],
		["script.contractsDeploy", scriptDeploy, true],
		["script.clean", scriptClean, true],
		["script.devStart", scriptDevStart, true],
		["script.devStop", scriptDevStop, false],
		["script.prodStart", scriptProdStart, true],
		["script.prodStop", scriptProdStop, true],
		["script.prodRebuild", scriptProdRebuild, true],
		["script.prodStatus", scriptProdStatus, true],
		["script.prodLogs", scriptProdLogs, false],
	];

	for (const [key, value, recommended] of scriptChecks) {
		if (!value) {
			checks.push({
				key,
				level: recommended ? "warn" : "ok",
				message: recommended
					? `${key}: not configured`
					: `${key}: optional (not configured)`,
			});
			continue;
		}
		checks.push({
			key,
			level: hasScript(scripts, value) ? "ok" : "warn",
			message: hasScript(scripts, value)
				? `${key}: script "${value}" found`
				: `${key}: script "${value}" not found in package.json`,
		});
	}

	const network = networkState.selected;
	const networkCfg = networkState.config;
	const artifactRel = cfg<string>(
		"contractsArtifactPath",
		".generated/project-example/dapp/src/generated/contracts-addresses.ts",
	);
	const artifactAbs = getContractsArtifactPath(cwd);
	const frontendContractFile = getFrontendContractFilePath(cwd);

	if (fs.existsSync(frontendContractFile)) {
		try {
			const src = fs.readFileSync(frontendContractFile, "utf8");
			if (src.includes("/api/contracts/deployed")) {
				checks.push({
					key: "frontend.addressSource",
					level: "warn",
					message:
						"Frontend currently fetches /api/contracts/deployed at runtime; migrate to generated chainId/address artifact lookup",
				});
			} else {
				checks.push({
					key: "frontend.addressSource",
					level: "ok",
					message:
						"Frontend does not rely on /api/contracts/deployed runtime lookup",
				});
			}
		} catch {
			checks.push({
				key: "frontend.addressSource",
				level: "warn",
				message: "Could not analyze frontend contract address source",
			});
		}
	}

	if (network === "local") {
		if (!nodeRunningState.nodeRunning) {
			checks.push({
				key: "contracts.reachability",
				level: "ok",
				message: "Local contract reachability skipped (node not running)",
			});
		} else {
			try {
				const deployed = await getDeployedContracts();
				const evmContracts = deployed.filter((c) => c.chain === "evm");
				if (evmContracts.length === 0) {
					checks.push({
						key: "contracts.reachability",
						level: "warn",
						message: "Local network: no eSpace deployed contracts found",
					});
				} else {
					const rpcUrl = cfg<string>("espaceRpc", networkCfg.espaceRpc);
					const code = await ethGetCode(rpcUrl, evmContracts[0].address);
					checks.push({
						key: "contracts.reachability",
						level: code && code !== "0x" ? "ok" : "warn",
						message:
							code && code !== "0x"
								? `Local contract reachable at ${evmContracts[0].address}`
								: `Local contract not reachable at ${evmContracts[0].address}`,
					});
				}
			} catch {
				checks.push({
					key: "contracts.reachability",
					level: "warn",
					message: "Could not query local deployed contracts (degraded mode)",
				});
			}
		}
	} else {
		if (!fs.existsSync(artifactAbs)) {
			checks.push({
				key: "contracts.artifact",
				level: "warn",
				message: `Artifact not found: ${artifactRel}`,
			});
			checks.push({
				key: "contracts.reachability",
				level: "warn",
				message: `Cannot validate ${networkCfg.label} reachability without artifact`,
			});
		} else {
			try {
				const src = fs.readFileSync(artifactAbs, "utf8");
				const addresses = extractAddressesForChain(
					src,
					networkCfg.espaceChainId,
				).slice(0, 5);
				if (!addresses.length) {
					checks.push({
						key: "contracts.reachability",
						level: "warn",
						message: `Artifact has no addresses for chainId ${networkCfg.espaceChainId}`,
					});
				} else {
					const rpcUrl = cfg<string>("espaceRpc", networkCfg.espaceRpc);
					let reachable = false;
					for (const address of addresses) {
						const code = await ethGetCode(rpcUrl, address);
						if (code && code !== "0x") {
							reachable = true;
							break;
						}
					}
					checks.push({
						key: "contracts.reachability",
						level: reachable ? "ok" : "warn",
						message: reachable
							? `${networkCfg.label}: at least one artifact contract is reachable`
							: `${networkCfg.label}: artifact contracts not reachable via RPC`,
					});
				}
			} catch {
				checks.push({
					key: "contracts.reachability",
					level: "warn",
					message: `Could not parse artifact ${artifactRel} (degraded mode)`,
				});
			}
		}
	}

	const warnCount = checks.filter((c) => c.level === "warn").length;
	const errorCount = checks.filter((c) => c.level === "error").length;
	return {
		checks,
		warnCount,
		errorCount,
		checkedAt: new Date().toISOString(),
	};
}

function renderDoctorSummary(report: DoctorReport): string {
	if (report.errorCount > 0)
		return `${report.errorCount} error(s), ${report.warnCount} warning(s)`;
	if (report.warnCount > 0) return `${report.warnCount} warning(s)`;
	return "healthy";
}

export function registerStatusBar(context: vscode.ExtensionContext): void {
	const bar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		10,
	);
	bar.command = "devkit.statusBarClick";
	bar.text = "$(loading~spin) Project…";
	bar.show();
	context.subscriptions.push(bar);

	let lastState: ProjectState = "idle";
	let lastDoctor: DoctorReport | null = null;

	async function showDoctorOutput(report: DoctorReport): Promise<void> {
		const out = vscode.window.createOutputChannel("Project Doctor");
		out.clear();
		out.appendLine("Project Doctor");
		out.appendLine("==============");
		out.appendLine(`Checked at: ${report.checkedAt}`);
		out.appendLine(`Network: ${networkState.config.label}`);
		out.appendLine(`Summary: ${renderDoctorSummary(report)}`);
		out.appendLine("");
		for (const c of report.checks) {
			const tag = c.level.toUpperCase().padEnd(5, " ");
			out.appendLine(`[${tag}] ${c.message}`);
		}
		out.show(true);
	}

	function getScriptFromSetting(key: string, def = ""): string {
		return cfg<string>(key, def).trim();
	}

	async function requireScript(
		cwd: string,
		key: string,
		label: string,
		def = "",
	): Promise<string | null> {
		const scripts = readPackageScripts(cwd);
		const script = getScriptFromSetting(key, def);
		if (!script) {
			const act = await vscode.window.showWarningMessage(
				`${label} script is not configured (${key}).`,
				"Open Setting",
			);
			if (act === "Open Setting") {
				await vscode.commands.executeCommand(
					"workbench.action.openSettings",
					`devkit.${key}`,
				);
			}
			return null;
		}
		if (!hasScript(scripts, script)) {
			const act = await vscode.window.showWarningMessage(
				`${label} script "${script}" not found in package.json scripts.`,
				"Open package.json",
				"Open Setting",
			);
			if (act === "Open package.json") {
				await vscode.window.showTextDocument(
					vscode.Uri.file(path.join(cwd, "package.json")),
				);
			}
			if (act === "Open Setting") {
				await vscode.commands.executeCommand(
					"workbench.action.openSettings",
					`devkit.${key}`,
				);
			}
			return null;
		}
		return script;
	}

	async function refresh(): Promise<void> {
		const cwd = getWorkspaceCwd();
		if (!cwd) {
			bar.text = "$(folder) Project";
			bar.tooltip = "No workspace open";
			bar.backgroundColor = undefined;
			return;
		}

		const devPort = cfg<number>("devPort", 3001);
		const prodPort = cfg<number>("prodPort", 3030);
		const devUp = await isDevServerRunning(devPort);
		const prodUp = await isProdServerRunning(prodPort);

		// Setup prerequisite
		if (!hasNodeModules(cwd)) {
			lastState = "setup-needed";
			bar.text = "$(package) Project: setup needed";
			bar.tooltip =
				"Dependencies not installed. Click for the Project menu and run Install dependencies.";
			bar.backgroundColor = new vscode.ThemeColor(
				"statusBarItem.warningBackground",
			);
			return;
		}

		if (devUp && prodUp) {
			lastState = "dev+prod";
			bar.text = `$(pulse) Project: dev+prod (:${devPort}|:${prodPort})`;
			bar.tooltip = `Dev and production previews are both running. Network: ${networkState.config.label}.`;
			bar.backgroundColor = undefined;
			return;
		}

		if (devUp) {
			lastState = "dev";
			bar.text = `$(pulse) Project: dev (:${devPort})`;
			bar.tooltip = `Dev environment running on port ${devPort}. Network: ${networkState.config.label}.`;
			bar.backgroundColor = undefined;
			return;
		}

		if (prodUp) {
			lastState = "prod";
			bar.text = `$(pulse) Project: production (:${prodPort})`;
			bar.tooltip = `Production preview running on port ${prodPort}. Network: ${networkState.config.label}.`;
			bar.backgroundColor = undefined;
			return;
		}

		if (lastDoctor && lastDoctor.warnCount > 0) {
			lastState = "degraded";
			bar.text = "$(warning) Project: degraded";
			bar.tooltip = `Health warnings detected (${lastDoctor.warnCount}). Click to run doctor or continue actions.`;
			bar.backgroundColor = new vscode.ThemeColor(
				"statusBarItem.warningBackground",
			);
			return;
		}

		lastState = "idle";
		bar.text = "$(debug-stop) Project: stopped";
		bar.tooltip = nodeRunningState.nodeRunning
			? "Node is active. Start dev or production, deploy contracts, or run doctor."
			: "Project idle. Use the menu to run doctor, install, deploy, or start dev/prod.";
		bar.backgroundColor = undefined;
	}

	// ── Commands ───────────────────────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand("devkit.projectDoctor", async () => {
			const cwd = getWorkspaceCwd();
			if (!cwd) return;

			const configuredDoctor = await requireScript(
				cwd,
				"scriptDoctor",
				"Doctor",
				"doctor",
			);
			if (configuredDoctor) {
				// Run configured doctor script as the strict script contract entrypoint.
				runScriptInTerminal("Project Doctor Script", cwd, configuredDoctor);
			}

			// Always run extension-side checks too (degraded mode, network reachability, frontend source audit).
			lastDoctor = await runProjectDoctor(cwd);
			await showDoctorOutput(lastDoctor);
			await refresh();
		}),

		vscode.commands.registerCommand("devkit.statusBarClick", async () => {
			const cwd = getWorkspaceCwd();
			if (!cwd) return;

			const depsInstalled = hasNodeModules(cwd);
			const nodeRunning = nodeRunningState.nodeRunning;
			const devRunning = await isDevServerRunning(cfg<number>("devPort", 3001));
			const prodRunning = await isProdServerRunning(
				cfg<number>("prodPort", 3030),
			);
			const networkReachable = await isSelectedNetworkReachable();
			const isLocalNetwork = networkState.selected === "local";
			const artifactPath = getContractsArtifactPath(cwd);
			const artifactPresent = fs.existsSync(artifactPath);

			const devPort = cfg<number>("devPort", 3001);
			const prodPort = cfg<number>("prodPort", 3030);

			const picks: Array<{ label: string; id: string; detail?: string }> = [
				{ label: "$(heart) Run doctor (health + reachability)", id: "doctor" },
			];

			if (!depsInstalled) {
				picks.push({ label: "$(package) Install dependencies", id: "install" });
			}
			picks.push({
				label: "$(trash) Clean workspace (remove node_modules + temp files)",
				id: "clean",
			});

			// Contracts deploy is available only when selected network RPC is reachable.
			if (networkReachable) {
				picks.push({ label: "$(cloud-upload) Deploy contracts", id: "deploy" });
			} else {
				picks.push({
					label: "$(warning) Deploy contracts (network unreachable)",
					id: "deployWarn",
					detail: `Cannot deploy while ${networkState.config.label} RPC is unreachable`,
				});
			}

			// DEV section: visible only when dependencies are installed.
			if (depsInstalled) {
				if (isLocalNetwork && !nodeRunning) {
					picks.push({
						label: "$(server-process) Start local node (required for dev)",
						id: "devStartNode",
					});
				} else if (!networkReachable) {
					picks.push({
						label: "$(warning) Start dev environment (network unreachable)",
						id: "devStartWarn",
						detail: `Cannot start safely while ${networkState.config.label} RPC is unreachable`,
					});
				} else if (!devRunning) {
					picks.push({
						label: "$(play) Start dev environment",
						id: "devStart",
					});
				} else {
					picks.push({
						label: `$(link-external) Open dev app (port ${devPort})`,
						id: "devOpen",
					});
					picks.push({ label: "$(output) View dev logs", id: "devLogs" });
					picks.push({
						label: "$(debug-stop) Stop dev environment",
						id: "devStop",
					});
				}
			}

			// PROD section: shown regardless of node_modules presence (compose can install internally).
			if (!artifactPresent) {
				picks.push({
					label: "$(warning) Production address artifact missing",
					id: "prodArtifactWarn",
					detail: path.relative(cwd, artifactPath),
				});
			}
			if (!prodRunning) {
				picks.push({
					label: "$(play) Start production preview",
					id: "prodStart",
				});
				picks.push({
					label: "$(refresh) Rebuild production preview",
					id: "prodRebuild",
				});
			} else {
				picks.push({
					label: `$(link-external) Open production app (port ${prodPort})`,
					id: "prodOpen",
				});
				picks.push({ label: "$(output) Production logs", id: "prodLogs" });
				picks.push({ label: "$(info) Production status", id: "prodStatus" });
				picks.push({
					label: "$(debug-stop) Stop production preview",
					id: "prodStop",
				});
			}

			const pick = await vscode.window.showQuickPick(picks, {
				placeHolder: `Project menu (${lastState}) — network: ${networkState.config.label}`,
			});

			if (!pick) return;

			if (pick.id === "doctor") {
				await vscode.commands.executeCommand("devkit.projectDoctor");
				return;
			}

			if (pick.id === "install") {
				const script = await requireScript(
					cwd,
					"scriptInstall",
					"Install dependencies",
				);
				if (!script) return;
				runScriptInTerminal("Project Install", cwd, script);
				return;
			}

			if (pick.id === "clean") {
				const script = await requireScript(
					cwd,
					"scriptClean",
					"Clean workspace",
					"clean",
				);
				if (!script) return;
				const confirm = await vscode.window.showWarningMessage(
					"Clean workspace? This removes node_modules and temporary/generated files defined by your clean script.",
					{ modal: true },
					"Clean",
				);
				if (confirm !== "Clean") return;
				runScriptInTerminal("Project Clean", cwd, script);
				setTimeout(() => void refresh(), 2_000);
				return;
			}

			if (pick.id === "deployWarn") {
				vscode.window.showWarningMessage(
					`Cannot deploy contracts: ${networkState.config.label} RPC is unreachable (${getSelectedEspaceRpc()}).`,
				);
				return;
			}

			if (pick.id === "deploy") {
				await vscode.commands.executeCommand("devkit.deployProjectContracts");
				return;
			}

			if (pick.id === "devStartNode") {
				await vscode.commands.executeCommand("cfxdevkit.nodeStart");
				return;
			}

			if (pick.id === "devStartWarn") {
				vscode.window.showWarningMessage(
					`Cannot start dev environment: ${networkState.config.label} RPC is unreachable (${getSelectedEspaceRpc()}).`,
				);
				return;
			}

			if (pick.id === "prodArtifactWarn") {
				const action = await vscode.window.showWarningMessage(
					`Production address artifact not found: ${path.relative(cwd, artifactPath)}`,
					"Run Deploy Contracts",
					"Run Doctor",
				);
				if (action === "Run Deploy Contracts") {
					await vscode.commands.executeCommand("devkit.deployProjectContracts");
				} else if (action === "Run Doctor") {
					await vscode.commands.executeCommand("devkit.projectDoctor");
				}
				return;
			}

			if (pick.id === "devStart") {
				await vscode.commands.executeCommand("devkit.startDev");
				return;
			}

			if (pick.id === "devStop") {
				await vscode.commands.executeCommand("devkit.stopDev");
				return;
			}

			if (pick.id === "devOpen") {
				vscode.env.openExternal(
					await vscode.env.asExternalUri(
						vscode.Uri.parse(`http://127.0.0.1:${devPort}/`),
					),
				);
				return;
			}

			if (pick.id === "devLogs") {
				void openManagedProcessLogs(DEV_PROCESS_ID, "Project Dev Server");
				return;
			}

			if (pick.id === "prodOpen") {
				vscode.env.openExternal(
					await vscode.env.asExternalUri(
						vscode.Uri.parse(`http://127.0.0.1:${prodPort}/`),
					),
				);
				return;
			}

			if (pick.id === "prodStart") {
				const script = await requireScript(
					cwd,
					"scriptProdStart",
					"Production start",
					"stack:up",
				);
				if (!script) return;
				runScriptWithEnvInTerminal(
					"Project Production Start",
					cwd,
					script,
					getProjectNetworkEnv(),
				);
				void refresh();

				const ready = await waitForServiceReady(
					"Starting production preview...",
					prodPort,
					() => isProdServerRunning(prodPort),
				);

				if (ready) {
					const action = await vscode.window.showInformationMessage(
						"Production preview is ready.",
						"Open App",
						"View Logs",
					);
					if (action === "Open App") {
						vscode.env.openExternal(
							await vscode.env.asExternalUri(
								vscode.Uri.parse(`http://127.0.0.1:${prodPort}/`),
							),
						);
					} else if (action === "View Logs") {
						const logsScript = getScriptFromSetting("scriptProdLogs");
						if (logsScript && hasScript(readPackageScripts(cwd), logsScript)) {
							runScriptInTerminal("Project Production Logs", cwd, logsScript);
						}
					}
				} else {
					const action = await vscode.window.showWarningMessage(
						"Production preview start command was sent, but the service is not reachable yet.",
						"View Logs",
					);
					if (action === "View Logs") {
						const logsScript = getScriptFromSetting("scriptProdLogs");
						if (logsScript && hasScript(readPackageScripts(cwd), logsScript)) {
							runScriptInTerminal("Project Production Logs", cwd, logsScript);
						}
					}
				}

				void refresh();
				return;
			}

			if (pick.id === "prodStop") {
				const script = await requireScript(
					cwd,
					"scriptProdStop",
					"Production stop",
					"stack:down",
				);
				if (!script) return;
				runScriptInTerminal("Project Production Stop", cwd, script);
				// Stop managed process only if this extension launched a long-running prod script.
				if (isManagedProcessRunning(PROD_PROCESS_ID)) {
					await stopManagedProcess(PROD_PROCESS_ID);
				}
				setTimeout(() => void refresh(), 4_000);
				return;
			}

			if (pick.id === "prodRebuild") {
				const script = await requireScript(
					cwd,
					"scriptProdRebuild",
					"Production rebuild",
					"stack:rebuild",
				);
				if (!script) return;
				runScriptWithEnvInTerminal(
					"Project Production Rebuild",
					cwd,
					script,
					getProjectNetworkEnv(),
				);
				setTimeout(() => void refresh(), 4_000);
				return;
			}

			if (pick.id === "prodLogs") {
				const script = await requireScript(
					cwd,
					"scriptProdLogs",
					"Production logs",
				);
				if (!script) return;
				runScriptInTerminal("Project Production Logs", cwd, script);
				return;
			}

			if (pick.id === "prodStatus") {
				const script = await requireScript(
					cwd,
					"scriptProdStatus",
					"Production status",
					"stack:status",
				);
				if (!script) return;
				runScriptInTerminal("Project Production Status", cwd, script);
			}
		}),

		// Deploy project contracts
		// Strict script contract: devkit.scriptContractsDeploy must point to a package.json script.
		vscode.commands.registerCommand(
			"devkit.deployProjectContracts",
			async () => {
				const deployDir = getWorkspaceCwd();
				if (!deployDir) return;

				const reachable = await isSelectedNetworkReachable();
				if (!reachable) {
					vscode.window.showWarningMessage(
						`Deploy blocked: ${networkState.config.label} RPC is unreachable (${getSelectedEspaceRpc()}).`,
					);
					return;
				}

				const script = await requireScript(
					deployDir,
					"scriptContractsDeploy",
					"Contracts deploy",
				);
				if (!script) return;

				runScriptWithEnvInTerminal(
					"Project Contracts Deploy",
					deployDir,
					script,
					getProjectNetworkEnv(),
				);
			},
		),

		// Start dev environment as a persistent background process.
		vscode.commands.registerCommand("devkit.startDev", async () => {
			const cwd = getWorkspaceCwd();
			if (!cwd) return;

			if (networkState.selected === "local" && !nodeRunningState.nodeRunning) {
				const action = await vscode.window.showWarningMessage(
					"Local node is required for local-network dev. Start local node now?",
					"Start Node",
					"Cancel",
				);
				if (action === "Start Node") {
					await vscode.commands.executeCommand("cfxdevkit.nodeStart");
				}
				return;
			}

			if (!(await isSelectedNetworkReachable())) {
				vscode.window.showWarningMessage(
					`Cannot start dev environment: ${networkState.config.label} RPC is unreachable (${getSelectedEspaceRpc()}).`,
				);
				return;
			}

			const devScript = await requireScript(cwd, "scriptDevStart", "Dev start");
			if (!devScript) return;

			const devPort = cfg<number>("devPort", 3001);

			await runManagedScript(
				DEV_PROCESS_ID,
				"Project Dev Server",
				cwd,
				devScript,
				getProjectNetworkEnv(),
			);

			void refresh();

			const ready = await waitForServiceReady(
				"Starting dev environment...",
				devPort,
				() => isDevServerRunning(devPort),
			);

			if (ready) {
				const action = await vscode.window.showInformationMessage(
					"Dev environment is ready.",
					"Open App",
					"View Logs",
				);
				if (action === "Open App") {
					vscode.env.openExternal(
						await vscode.env.asExternalUri(
							vscode.Uri.parse(`http://127.0.0.1:${devPort}/`),
						),
					);
				} else if (action === "View Logs") {
					void openManagedProcessLogs(DEV_PROCESS_ID, "Project Dev Server");
				}
			} else {
				const action = await vscode.window.showWarningMessage(
					"Dev start command was sent, but the app is not reachable yet.",
					"View Logs",
				);
				if (action === "View Logs") {
					void openManagedProcessLogs(DEV_PROCESS_ID, "Project Dev Server");
				}
			}

			void refresh();
		}),

		// Stop dev server using its tracked process
		vscode.commands.registerCommand("devkit.stopDev", async () => {
			const cwd = getWorkspaceCwd();
			if (!cwd) return;

			const devStopScript = getScriptFromSetting("scriptDevStop");
			if (devStopScript && hasScript(readPackageScripts(cwd), devStopScript)) {
				runScriptInTerminal("Project Dev Stop", cwd, devStopScript);
			}

			await stopManagedProcess(DEV_PROCESS_ID);
			setTimeout(() => void refresh(), 2_000);
		}),
	);

	// Re-check immediately when the Conflux node state changes
	context.subscriptions.push(
		nodeRunningState.onDidChange(() => void refresh()),
	);
	context.subscriptions.push(networkState.onDidChange(() => void refresh()));

	void refresh();
	const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"devkit.refreshStatus",
			() => void refresh(),
		),
	);
}
