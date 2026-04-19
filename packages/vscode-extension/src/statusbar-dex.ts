/**
 * statusbar-dex.ts
 *
 * Status bar item for the standalone DEX UI (Uniswap V2 swap / LP / vault interface).
 * The DEX UI runs as a Node.js process (server.mjs) inside the devkit container.
 *
 * States:
 *   $(server-process) DEX UI: stopped  — server not running
 *   $(loading~spin)   DEX UI: starting — server starting up
 *   $(pulse)          DEX UI: running  — server responding to /health
 *   $(warning)        DEX UI: not installed — devkit-dex-ui package missing
 *
 * Auto-show: polls the DEX service's /api/dex/manifest — when a manifest is available
 * (written by dex_deploy via MCP), shows the status bar and offers to start if stopped.
 *
 * All lifecycle events are logged to the "DEX UI" output channel.
 */

import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { getDeployedContracts } from "./conflux/api";
import {
	isManagedProcessRunning,
	openManagedProcessLogs,
	startManagedProcess,
	stopManagedProcess,
	tailManagedProcessLog,
} from "./utils/persistent-process";
import { nodeRunningState } from "./views/node-state";

const POLL_INTERVAL_MS = 15_000;
const DEX_PROCESS_ID = "dex-ui-server";

/** Cached resolved server directory — avoids repeated child-process spawns on each poll. */
let _cachedServerDir: string | null = null;

/** Shared output channel for all DEX lifecycle events. */
let _outputChannel: vscode.OutputChannel | null = null;

function getOutputChannel(): vscode.OutputChannel {
	if (!_outputChannel) {
		_outputChannel = vscode.window.createOutputChannel("DEX");
	}
	return _outputChannel;
}

function log(message: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	getOutputChannel().appendLine(`[${ts}] ${message}`);
}

function getDexServerDir(): string {
	if (
		_cachedServerDir &&
		fs.existsSync(path.join(_cachedServerDir, "server.mjs"))
	) {
		return _cachedServerDir;
	}

	const configured = vscode.workspace
		.getConfiguration("cfxdevkit")
		.get<string>("dexServerScript");
	if (configured) {
		_cachedServerDir = path.dirname(configured);
		return _cachedServerDir;
	}

	// Primary install path — verified against devkit-devcontainer:local image.
	// npm installs @devkit/devkit-dex-ui globally so server.mjs is always here.
	const primaryPath = "/usr/local/lib/node_modules/@devkit/devkit-dex-ui";
	if (fs.existsSync(path.join(primaryPath, "server.mjs"))) {
		log(`Resolved DEX server dir (primary): ${primaryPath}`);
		_cachedServerDir = primaryPath;
		return _cachedServerDir;
	}

	// Secondary well-known paths (other distros / manual installs)
	const staticCandidates = [
		"/usr/lib/node_modules/@devkit/devkit-dex-ui",
		"/usr/local/lib/node_modules/devkit-dex-ui",
		"/opt/devkit/apps/dex-ui",
	];
	const staticFound = staticCandidates.find((dir) =>
		fs.existsSync(path.join(dir, "server.mjs")),
	);
	if (staticFound) {
		log(`Resolved DEX server dir via static candidate: ${staticFound}`);
		_cachedServerDir = staticFound;
		return _cachedServerDir;
	}

	// Use explicit PATH that includes common npm global bin locations to work
	// correctly in the VS Code extension host (where PATH may be trimmed).
	const extendedEnv = {
		...process.env,
		PATH: [
			process.env.PATH ?? "",
			"/usr/local/bin",
			"/usr/bin",
			"/opt/homebrew/bin",
		].join(":"),
	};

	// Resolve via 'which devkit-dex-ui' — follows symlink to find the package root.
	try {
		const binPath = cp
			.execSync("which devkit-dex-ui", { encoding: "utf8", env: extendedEnv })
			.trim();
		if (binPath) {
			const realPath = fs.realpathSync(binPath);
			const dirs = [
				path.dirname(realPath),
				path.dirname(path.dirname(realPath)),
			];
			for (const dir of dirs) {
				if (fs.existsSync(path.join(dir, "server.mjs"))) {
					log(`Resolved DEX server dir via which: ${dir}`);
					_cachedServerDir = dir;
					return _cachedServerDir;
				}
			}
			log(
				`which devkit-dex-ui → ${realPath} (server.mjs not found in ${dirs.join(" or ")})`,
			);
		}
	} catch {
		/* not in PATH */
	}

	// Fallback: check npm global prefix
	try {
		const prefix = cp
			.execSync("npm prefix -g", { encoding: "utf8", env: extendedEnv })
			.trim();
		const candidates = [
			path.join(prefix, "lib", "node_modules", "@devkit", "devkit-dex-ui"),
			path.join(prefix, "lib", "node_modules", "devkit-dex-ui"),
		];
		for (const pkgDir of candidates) {
			if (fs.existsSync(path.join(pkgDir, "server.mjs"))) {
				log(`Resolved DEX server dir via npm prefix -g: ${pkgDir}`);
				_cachedServerDir = pkgDir;
				return _cachedServerDir;
			}
		}
	} catch {
		/* no npm */
	}

	log(
		`DEX server dir not found — tried primary path, static candidates, which, npm prefix -g`,
	);
	// Return primary path so error messages are meaningful
	return primaryPath;
}

function getDexServerScript(): string {
	return path.join(getDexServerDir(), "server.mjs");
}

function getDexUrl(): string {
	const port =
		vscode.workspace.getConfiguration("cfxdevkit").get<number>("dexUiPort") ??
		8888;
	return `http://127.0.0.1:${port}`;
}

function shouldAutoStartDexWhenDeployed(): boolean {
	return vscode.workspace
		.getConfiguration("cfxdevkit")
		.get<boolean>("dexAutoStartWhenDeployed", true);
}

type DexUiState = "stopped" | "starting" | "running" | "setup-needed";

/** Check if DEX UI is ready (server.mjs accessible, OR server already responding). */
async function isDexUiReady(): Promise<boolean> {
	// Fast path: if the server is already running, consider it installed regardless
	// of whether server.mjs is visible on the local filesystem.
	try {
		const r = await fetch(`${getDexUrl()}/health`, {
			signal: AbortSignal.timeout(2_000),
		});
		if (r.ok) return true;
	} catch {
		/* not running — fall through to filesystem check */
	}

	// Quickest filesystem indicator: the bin symlink at the well-known global bin dir.
	// `/usr/local/bin/devkit-dex-ui` is always present when the package is installed,
	// regardless of the npm prefix layout (verified against devkit-devcontainer:local).
	if (fs.existsSync("/usr/local/bin/devkit-dex-ui")) return true;

	// Fallback: resolved server dir (covers custom installs via cfxdevkit.dexServerScript).
	const serverDir = getDexServerDir();
	return fs.existsSync(path.join(serverDir, "server.mjs"));
}

/** Check if the DEX UI server is responding. */
async function getDexUiState(): Promise<DexUiState> {
	try {
		const r = await fetch(`${getDexUrl()}/health`, {
			signal: AbortSignal.timeout(3_000),
		});
		if (r.ok) return "running";
	} catch {
		/* not running */
	}
	return "stopped";
}

/**
 * Check if DEX contracts have been deployed.
 * Tries the DEX UI manifest endpoint first; falls back to the devkit contract
 * registry so detection works even when the DEX UI server is not yet running.
 */
async function isDexDeployed(): Promise<boolean> {
	// 1. DEX UI manifest (fast path when UI is running)
	try {
		const r = await fetch(`${getDexUrl()}/api/dex/manifest`, {
			signal: AbortSignal.timeout(2_000),
		});
		if (r.ok) {
			const data = await r.json();
			if (data !== null && data !== undefined) return true;
		}
	} catch {
		/* DEX UI not running */
	}

	// 2. Devkit contract registry (works even before DEX UI is started)
	try {
		const contracts = await getDeployedContracts();
		return contracts.some((c) => c.name?.includes("UniswapV2Factory"));
	} catch {
		/* devkit not available */
	}

	return false;
}

async function openDexUi(): Promise<void> {
	const uri = await vscode.env.asExternalUri(
		vscode.Uri.parse(`${getDexUrl()}/`),
	);
	await vscode.env.openExternal(uri);
}

async function ensureDexDeployedOrKickoff(): Promise<boolean> {
	const deployed = await isDexDeployed();
	if (deployed) return true;

	const action = await vscode.window.showWarningMessage(
		"DEX contracts are not deployed yet. Run DEX deploy first?",
		"Deploy DEX",
		"Cancel",
	);
	if (action === "Deploy DEX") {
		await vscode.commands.executeCommand("cfxdevkit.deployDex");
	}
	return false;
}

export function registerDexUiStatusBar(context: vscode.ExtensionContext): void {
	const bar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		8,
	);
	bar.command = "cfxdevkit.dexUiClick";
	bar.tooltip = "DEX — Uniswap V2 swap/LP interface (click for actions)";
	bar.text = "$(loading~spin) DEX";
	bar.hide();
	context.subscriptions.push(bar);
	context.subscriptions.push(getOutputChannel());

	let lastState: DexUiState = "stopped";
	let starting = false;
	/** Stops the active DEX UI log tailer when the process stops or is replaced. */
	let _stopDexLogTail: (() => void) | null = null;

	// ── Render ───────────────────────────────────────────────────────────────
	async function refresh(): Promise<void> {
		// Only show when local Conflux node is running
		if (!nodeRunningState.nodeRunning) {
			bar.hide();
			return;
		}

		if (starting) {
			bar.text = "$(loading~spin) DEX: starting";
			bar.show();
			return;
		}

		// Check if server is installed
		if (!(await isDexUiReady())) {
			lastState = "setup-needed";
			bar.text = "$(warning) DEX: not installed";
			bar.tooltip =
				"DEX UI package not found — devkit-dex-ui may not be installed globally";
			bar.backgroundColor = new vscode.ThemeColor(
				"statusBarItem.warningBackground",
			);
			bar.show();
			return;
		}

		const state = await getDexUiState();
		const processRunning = isManagedProcessRunning(DEX_PROCESS_ID);
		const effectiveState: DexUiState =
			state === "running" ? "running" : processRunning ? "starting" : "stopped";
		lastState = effectiveState;
		bar.show(); // always visible when node is running

		switch (effectiveState) {
			case "stopped":
				bar.text = "$(server-process) DEX: stopped";
				bar.tooltip = "DEX stopped — click to start";
				bar.backgroundColor = undefined;
				// Auto-start once when DEX contracts are deployed
				if (shouldAutoStartDexWhenDeployed() && !hasShownPrompt) {
					const deployed = await isDexDeployed();
					if (deployed) {
						hasShownPrompt = true;
						log("Auto-starting DEX UI (contracts detected)");
						vscode.commands.executeCommand("cfxdevkit.dexUiStart");
					}
				}
				break;
			case "starting":
				bar.text = "$(loading~spin) DEX: starting";
				bar.tooltip = "DEX process is starting — click for logs or stop.";
				bar.backgroundColor = undefined;
				break;
			case "running":
				bar.text = "$(pulse) DEX: running";
				bar.tooltip = `DEX running at ${getDexUrl()} — click to open or manage`;
				bar.backgroundColor = undefined;
				break;
		}
	}

	// ── Commands ─────────────────────────────────────────────────────────────
	context.subscriptions.push(
		vscode.commands.registerCommand("cfxdevkit.dexUiStart", async () => {
			// Check if server script exists
			if (!(await isDexUiReady())) {
				vscode.window
					.showErrorMessage(
						"DEX UI not found. The devkit-dex-ui package may not be installed.",
						"Show Logs",
					)
					.then((a) => {
						if (a === "Show Logs") getOutputChannel().show(true);
					});
				starting = false;
				await refresh();
				return;
			}

			const deployed = await ensureDexDeployedOrKickoff();
			if (!deployed) {
				starting = false;
				await refresh();
				return;
			}

			starting = true;
			bar.text = "$(loading~spin) DEX UI: starting";
			bar.show();
			log("Starting DEX UI server...");

			if (!isManagedProcessRunning(DEX_PROCESS_ID)) {
				const script = getDexServerScript();
				log(`Command: node "${script}"`);
				await startManagedProcess({
					id: DEX_PROCESS_ID,
					label: "DEX UI",
					cwd: path.dirname(script),
					command: `node "${script}"`,
				});
				// Stream process output into the DEX output channel.
				_stopDexLogTail?.();
				_stopDexLogTail = tailManagedProcessLog(
					DEX_PROCESS_ID,
					getOutputChannel(),
				);
			}

			// Poll until running (up to 60s)
			const deadline = Date.now() + 60_000;
			const poll = setInterval(async () => {
				const s = await getDexUiState();
				if (s === "running" || Date.now() > deadline) {
					starting = false;
					clearInterval(poll);
					await refresh();
					if (s === "running") {
						log(`DEX UI running at ${getDexUrl()}`);
						const action = await vscode.window.showInformationMessage(
							"DEX UI started!",
							"Open in Browser",
							"Show Logs",
						);
						if (action === "Open in Browser") void openDexUi();
						if (action === "Show Logs") getOutputChannel().show(true);
					} else {
						log("DEX UI failed to start within 60s");
						const action = await vscode.window.showWarningMessage(
							"DEX UI did not start within 60 seconds.",
							"View Logs",
							"Retry",
						);
						if (action === "View Logs")
							void openManagedProcessLogs(DEX_PROCESS_ID, "DEX UI");
						if (action === "Retry")
							void vscode.commands.executeCommand("cfxdevkit.dexUiRestart");
					}
				}
			}, 3_000);
			context.subscriptions.push({ dispose: () => clearInterval(poll) });
		}),

		vscode.commands.registerCommand("cfxdevkit.dexUiStop", async () => {
			starting = false;
			log("Stopping DEX UI server...");
			_stopDexLogTail?.();
			_stopDexLogTail = null;
			await stopManagedProcess(DEX_PROCESS_ID);
			log("DEX UI stopped.");
			setTimeout(() => void refresh(), 2_000);
		}),

		vscode.commands.registerCommand("cfxdevkit.dexUiRestart", async () => {
			starting = true;
			bar.text = "$(loading~spin) DEX: restarting";
			bar.show();
			log("Restarting DEX UI server...");

			await stopManagedProcess(DEX_PROCESS_ID);

			// Wait a beat, then start fresh
			await new Promise((r) => setTimeout(r, 1_000));

			const script = getDexServerScript();
			await startManagedProcess({
				id: DEX_PROCESS_ID,
				label: "DEX UI",
				cwd: path.dirname(script),
				command: `node "${script}"`,
			});
			// Stream process output into the DEX output channel.
			_stopDexLogTail?.();
			_stopDexLogTail = tailManagedProcessLog(
				DEX_PROCESS_ID,
				getOutputChannel(),
			);
			log("DEX UI process launched, waiting for /health...");

			const deadline = Date.now() + 60_000;
			const poll = setInterval(async () => {
				const s = await getDexUiState();
				if (s === "running" || Date.now() > deadline) {
					starting = false;
					clearInterval(poll);
					await refresh();
					if (s === "running") {
						log(`DEX UI restarted at ${getDexUrl()}`);
					} else {
						log("DEX UI failed to restart within 60s");
					}
				}
			}, 3_000);
			context.subscriptions.push({ dispose: () => clearInterval(poll) });
		}),

		vscode.commands.registerCommand("cfxdevkit.dexUiClick", async () => {
			// Not installed — show info
			if (lastState === "setup-needed") {
				const pick = await vscode.window.showQuickPick(
					[
						{
							label: "$(output) Show Logs",
							detail: "View the DEX output channel",
							id: "logs",
						},
						{ label: "$(refresh) Refresh status", id: "refresh" },
					],
					{ placeHolder: "DEX UI package (devkit-dex-ui) is not installed." },
				);
				if (!pick) return;
				if (pick.id === "logs") getOutputChannel().show(true);
				if (pick.id === "refresh") await refresh();
				return;
			}

			if (lastState === "stopped") {
				const deployed = await isDexDeployed();
				if (!deployed) {
					const pick = await vscode.window.showQuickPick(
						[
							{
								label: "$(rocket) Deploy DEX stack",
								detail: "Deploy Factory + WETH9 + Router02 and seed pools",
								id: "deploy",
							},
							{
								label: "$(output) Show Logs",
								detail: "View the DEX output channel",
								id: "logs",
							},
							{ label: "$(refresh) Refresh status", id: "refresh" },
						],
						{
							placeHolder:
								"DEX contracts are missing. Deploy first to initialize DEX UI.",
						},
					);
					if (!pick) return;
					if (pick.id === "deploy") {
						await vscode.commands.executeCommand("cfxdevkit.deployDex");
					}
					if (pick.id === "logs") getOutputChannel().show(true);
					if (pick.id === "refresh") await refresh();
					return;
				}

				// DEX deployed but stopped — always show menu (don't auto-start silently)
				const pick = await vscode.window.showQuickPick(
					[
						{
							label: "$(play) Start DEX UI",
							detail: `Launch the DEX interface at ${getDexUrl()}`,
							id: "start",
						},
						{
							label: "$(output) Show Logs",
							detail: "View the DEX output channel",
							id: "logs",
						},
						{ label: "$(refresh) Refresh status", id: "refresh" },
					],
					{ placeHolder: "DEX UI is stopped. Start the swap interface?" },
				);
				if (!pick) return;
				if (pick.id === "start")
					vscode.commands.executeCommand("cfxdevkit.dexUiStart");
				if (pick.id === "logs") getOutputChannel().show(true);
				if (pick.id === "refresh") await refresh();
				return;
			}

			if (lastState === "starting") {
				const pick = await vscode.window.showQuickPick(
					[
						{
							label: "$(output) Show Logs",
							detail: "View startup progress",
							id: "logs",
						},
						{
							label: "$(debug-stop) Stop",
							detail: "Cancel startup and stop the server",
							id: "stop",
						},
					],
					{ placeHolder: "DEX UI is starting up…" },
				);
				if (!pick) return;
				if (pick.id === "logs") getOutputChannel().show(true);
				if (pick.id === "stop")
					vscode.commands.executeCommand("cfxdevkit.dexUiStop");
				return;
			}

			const pick = await vscode.window.showQuickPick(
				[
					{
						label: `$(link-external) Open DEX UI (port ${vscode.workspace.getConfiguration("cfxdevkit").get<number>("dexUiPort") ?? 8888})`,
						id: "open",
					},
					{ label: "$(output) Show Logs", id: "logs" },
					{ label: "$(refresh) Restart", id: "restart" },
					{ label: "$(debug-stop) Stop DEX UI", id: "stop" },
				],
				{ placeHolder: "DEX UI — Uniswap V2 swap / LP interface" },
			);
			if (!pick) return;
			if (pick.id === "open") void openDexUi();
			if (pick.id === "logs") getOutputChannel().show(true);
			if (pick.id === "restart")
				vscode.commands.executeCommand("cfxdevkit.dexUiRestart");
			if (pick.id === "stop")
				vscode.commands.executeCommand("cfxdevkit.dexUiStop");
		}),
	);

	// ── Auto-show: react to node state changes and poll ───────────────────────
	let hasShownPrompt = false;

	// React immediately when the local Conflux node starts or stops
	context.subscriptions.push(
		nodeRunningState.onDidChange(() => void refresh()),
	);

	void refresh();

	const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
	context.subscriptions.push({ dispose: () => clearInterval(timer) });
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"cfxdevkit.dexUiRefresh",
			() => void refresh(),
		),
		vscode.commands.registerCommand("cfxdevkit.dexUiSetup", async () => {
			// Clear the cache so next refresh re-probes the filesystem.
			_cachedServerDir = null;
			if (await isDexUiReady()) {
				vscode.window.showInformationMessage(
					"DEX UI package is already installed.",
				);
			} else {
				vscode.window.showErrorMessage(
					"DEX UI package (devkit-dex-ui) is not installed. Rebuild the devkit image.",
				);
			}
			await refresh();
		}),
		vscode.commands.registerCommand("cfxdevkit.dexUiShowLogs", () => {
			getOutputChannel().show(true);
		}),
	);
}
