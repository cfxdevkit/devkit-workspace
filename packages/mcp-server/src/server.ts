import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DevkitConfig } from "@devkit/shared";
import {
	getComposeStatus,
	isDockerAvailable,
	runCompose,
} from "@devkit/shared";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
	blockchainToolDefinitions,
	blockchainToolHandler,
} from "./blockchain.js";
import { DevkitClient } from "./clients/devkit-client.js";
import { compilerToolDefinitions, compilerToolHandler } from "./compiler.js";
import { saveContract } from "./contracts.js";
import {
	addOperationStep,
	finishOperation,
	getOperation,
	listOperations,
	startOperation,
} from "./operation-ledger.js";
import { handleConfluxContractsTool } from "./orchestration/conflux-contracts.js";
import { handleConfluxKeystoreTool } from "./orchestration/conflux-keystore.js";
import { handleConfluxLifecycleTool } from "./orchestration/conflux-lifecycle.js";
import { handleConfluxNetworkTool } from "./orchestration/conflux-network.js";
import type { RuntimeContext } from "./runtime-context.js";
import {
	getWorkspaceContext,
	isWorkspaceContainerContext,
	resolveDevkitPort,
} from "./runtime-context.js";

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const BACKEND_ENDPOINT_CATALOG: Record<string, string[]> = {
	health: ["GET /health"],
	settings: ["GET /api/settings"],
	node: [
		"GET /api/node/status",
		"POST /api/node/start",
		"POST /api/node/stop",
		"POST /api/node/restart",
		"POST /api/node/restart-wipe",
		"POST /api/node/wipe",
	],
	keystore: [
		"GET /api/keystore/status",
		"POST /api/keystore/generate",
		"POST /api/keystore/setup",
		"POST /api/keystore/unlock",
		"POST /api/keystore/lock",
		"GET /api/keystore/wallets",
		"POST /api/keystore/wallets",
		"POST /api/keystore/wallets/:id/activate",
		"DELETE /api/keystore/wallets/:id",
		"PATCH /api/keystore/wallets/:id",
	],
	accounts: [
		"GET /api/accounts",
		"GET /api/accounts/faucet",
		"POST /api/accounts/fund",
	],
	contracts: [
		"GET /api/contracts/templates",
		"GET /api/contracts/templates/:name",
		"POST /api/contracts/compile",
		"POST /api/contracts/deploy",
		"GET /api/contracts/deployed",
		"GET /api/contracts/deployed/:id",
		"DELETE /api/contracts/deployed/:id",
		"DELETE /api/contracts/deployed",
		"POST /api/contracts/register",
		"POST /api/contracts/:id/call",
	],
	bootstrap: [
		"GET /api/bootstrap/catalog",
		"GET /api/bootstrap/catalog/:name",
		"POST /api/bootstrap/deploy",
	],
	mining: [
		"GET /api/mining/status",
		"POST /api/mining/mine",
		"POST /api/mining/start",
		"POST /api/mining/stop",
	],
	network: [
		"GET /api/network/current",
		"PUT /api/network/current",
		"GET /api/network/capabilities",
		"GET /api/network/config",
		"PUT /api/network/config",
		"GET /api/network/rpc-urls",
	],
	dex: [
		"GET /api/dex/status",
		"POST /api/dex/deploy",
		"POST /api/dex/seed",
		"GET /api/dex/manifest",
		"GET /api/dex/translation-table",
		"GET /api/dex/pricing/wcfx-usd",
		"DELETE /api/dex/state",
		"GET /api/dex/source-pools/suggestions",
	],
};

async function devkitApiRequest(params: {
	path: string;
	method?: HttpMethod;
	body?: unknown;
	port?: number;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
	const { path, method = "GET", body, port = 7748 } = params;
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const url = `http://127.0.0.1:${port}${normalizedPath}`;
	const res = await fetch(url, {
		method,
		headers: { "Content-Type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(20_000),
	});

	let json: unknown;
	try {
		json = await res.json();
	} catch {
		json = { error: `Non-JSON response from ${normalizedPath}` };
	}

	return { ok: res.ok, status: res.status, json };
}

async function executeRunbook(params: {
	runbook: string;
	args: Record<string, unknown>;
	devkitCfg: DevkitConfig;
	composeOpts: { composeFile?: string };
	workspaceCtx: RuntimeContext;
	devkitClient: DevkitClient;
	operationId?: string;
}): Promise<{ text: string; isError?: boolean }> {
	const {
		runbook,
		args,
		devkitCfg,
		composeOpts,
		workspaceCtx,
		devkitClient,
		operationId,
	} = params;
	const steps: string[] = [];
	const failures: string[] = [];
	const _rpcUrl =
		(args.rpcUrl as string | undefined) ?? "http://localhost:8545";
	const _chainId = (args.chainId as number | undefined) ?? 2030;
	const bootstrapName = (args.name as string | undefined) ?? "ERC20Base";
	const deployChain = (args.chain as "evm" | "core" | undefined) ?? "evm";
	const deployArgs = (args.args as unknown[] | undefined) ?? [];

	if (runbook === "local_bootstrap_token_deploy") {
		if (operationId)
			addOperationStep(
				operationId,
				"Starting local bootstrap token deploy checks",
			);
		const docker = isDockerAvailable();
		if (!docker && !isWorkspaceContainerContext(workspaceCtx)) {
			failures.push("Docker is not reachable.");
		} else if (docker) {
			const compose = getComposeStatus(composeOpts);
			steps.push(`compose_services=${compose.services.length}`);
			if (operationId)
				addOperationStep(
					operationId,
					`Compose services detected: ${compose.services.length}`,
				);
		} else {
			steps.push(
				"docker=unreachable (non-blocking in workspace-container mode)",
			);
		}

		const status = await devkitClient.getStatus(devkitCfg).catch(() => null);
		if (!status?.serverOnline) {
			failures.push(
				"conflux-devkit server is offline (run conflux_server_start first).",
			);
		}
		if (!status?.keystoreStatus?.initialized) {
			failures.push("keystore is not initialized (run conflux_setup_init).");
		}
		if (status?.keystoreStatus?.locked) {
			failures.push("keystore is locked (run conflux_keystore_unlock).");
		}
		if (!status?.nodeRunning) {
			failures.push("node is not running (run conflux_node_start).");
		}

		const prepare = await devkitApiRequest({
			path: `/api/bootstrap/catalog/${encodeURIComponent(bootstrapName)}`,

			method: "GET",
			port: devkitCfg.port,
		});
		if (!prepare.ok) {
			failures.push(`bootstrap preset ${bootstrapName} is unavailable.`);
		} else {
			steps.push(`preset=${bootstrapName}`);
			if (operationId)
				addOperationStep(
					operationId,
					`Bootstrap preset ready: ${bootstrapName}`,
				);
		}

		if (failures.length > 0) {
			return {
				text: ["❌ Runbook blocked.", ...failures.map((f) => `- ${f}`)].join(
					"\n",
				),
				isError: true,
			};
		}

		const deploy = await devkitClient.deployBootstrapContract(
			bootstrapName,
			deployArgs,
			deployChain,
			(args.accountIndex as number | undefined) ?? 0,
			devkitCfg,
		);
		steps.push(`deployed=${deploy.address}`);
		if (operationId)
			addOperationStep(operationId, `Deployment complete at ${deploy.address}`);
		return {
			text: [
				"✅ Runbook completed: local_bootstrap_token_deploy",
				...steps.map((s) => `- ${s}`),
				`- chain=${deploy.chain}`,
				`- tx=${deploy.txHash ?? "n/a"}`,
			].join("\n"),
		};
	}

	if (runbook === "local_stack_doctor") {
		if (operationId) addOperationStep(operationId, "Running stack diagnostics");
		const docker = isDockerAvailable();
		const compose = docker ? getComposeStatus(composeOpts) : null;
		const status = await devkitClient.getStatus(devkitCfg).catch(() => null);

		return {
			text: [
				"=== local_stack_doctor ===",
				`runtime_mode=${workspaceCtx.runtimeMode}`,
				`backend=${workspaceCtx.backendBaseUrl}`,
				`docker=${docker ? "ok" : "down"}`,
				`compose_services=${compose?.services.length ?? 0}`,
				`server=${status?.serverOnline ? "online" : "offline"}`,
				`keystore_initialized=${status?.keystoreStatus?.initialized ? "yes" : "no"}`,
				`keystore_locked=${status?.keystoreStatus?.locked ? "yes" : "no"}`,
				`node_running=${status?.nodeRunning ? "yes" : "no"}`,
				`next_step=${status?.nextStep ?? "run conflux_status"}`,
			].join("\n"),
			isError: !status?.serverOnline,
		};
	}

	return {
		text: `Unsupported runbook: ${runbook}. Supported: local_stack_doctor, local_bootstrap_token_deploy`,
		isError: true,
	};
}

export function createDevkitMcpServer(): Server {
	const server = new Server(
		{ name: "cfxdevkit", version: "0.1.0" },
		{ capabilities: { tools: {} } },
	);

	// ── Tool definitions ─────────────────────────────────────────────────────────

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			// ── Docker Compose tools ────────────────────────────────────────────────
			{
				name: "workspace_status",
				description:
					"Get the current status of Docker Compose services in this workspace. " +
					"Returns which services are running, stopped, or missing.",
				inputSchema: {
					type: "object",
					properties: {
						composeFile: {
							type: "string",
							description:
								"Path to docker-compose.yml (default: docker-compose.yml in workspace root)",
						},
					},
				},
			},
			{
				name: "workspace_start",
				description:
					"Start all Docker Compose services in this workspace (docker compose up -d).",
				inputSchema: {
					type: "object",
					properties: {
						composeFile: { type: "string" },
						service: {
							type: "string",
							description: "Optional: start only this specific service",
						},
					},
				},
			},
			{
				name: "workspace_stop",
				description:
					"Stop Docker Compose services in this workspace (docker compose stop).",
				inputSchema: {
					type: "object",
					properties: {
						composeFile: { type: "string" },
						service: {
							type: "string",
							description: "Optional: stop only this specific service",
						},
					},
				},
			},
			{
				name: "workspace_logs",
				description: "Get recent logs from Docker Compose services.",
				inputSchema: {
					type: "object",
					properties: {
						composeFile: { type: "string" },
						service: {
							type: "string",
							description: "Service name (omit for all)",
						},
						lines: {
							type: "number",
							description: "Number of log lines to return (default: 50)",
						},
					},
				},
			},
			{
				name: "docker_available",
				description:
					"Check whether the Docker daemon is reachable from this workspace.",
				inputSchema: { type: "object", properties: {} },
			},
			{
				name: "backend_api_catalog",
				description:
					"List all known conflux-devkit backend HTTP endpoints grouped by domain. " +
					"Use with backend_api_call for direct endpoint access when a dedicated MCP tool is unavailable.",
				inputSchema: { type: "object", properties: {} },
			},
			{
				name: "backend_health",
				description: "Call backend health endpoint (/health).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "backend_api_call",
				description:
					"Direct HTTP call to local conflux-devkit backend. " +
					"Supports GET/POST/PUT/DELETE for /health and /api/* paths with JSON body.",
				inputSchema: {
					type: "object",
					required: ["path"],
					properties: {
						path: {
							type: "string",
							description:
								"Endpoint path, e.g. /api/network/current or /health",
						},
						method: {
							type: "string",
							enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
							description: "HTTP method (default: GET)",
						},
						body: {
							description: "Optional JSON body for POST/PUT calls",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_status",
				description:
					"Read backend-owned DEX deployment status and on-chain pair count.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_deploy",
				description:
					"Deploy the backend-owned Uniswap V2 stack through the conflux-devkit backend.",
				inputSchema: {
					type: "object",
					properties: {
						accountIndex: {
							type: "number",
							description: "Deployer account index (default: 0)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_manifest",
				description:
					"Get deployed DEX contract addresses (factory, router02, WETH9/WCFX). " +
					"Use this after dex_deploy to retrieve the contract addresses needed for direct contract interaction.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_translation_table",
				description:
					"Get the token symbol → ERC-20 contract address mapping for all tokens deployed in the local DEX. " +
					'Use this to resolve token symbols (e.g. "USDT", "BTC", "WCFX") to their on-chain addresses for contract calls.',
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_wcfx_price",
				description: "Get the current WCFX/USD price from the local DEX.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_reset",
				description:
					"Reset (wipe) all local DEX state: deployed contracts, seeded pools, and token registry. " +
					"After calling this, run dex_deploy + dex_seed_from_gecko to rebuild from scratch.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_source_pools",
				description:
					"Get available GeckoTerminal pool suggestions for DEX seeding. " +
					"Returns pool addresses and token pairs that can be passed to dex_seed_from_gecko.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "dex_seed_from_gecko",
				description:
					"Seed the backend-owned DEX from live GeckoTerminal WCFX pools through the conflux-devkit backend.",
				inputSchema: {
					type: "object",
					properties: {
						accountIndex: {
							type: "number",
							description: "Deployer account index (default: 0)",
						},
						selectedPoolAddresses: {
							type: "array",
							items: { type: "string" },
							description:
								"Optional explicit GeckoTerminal pool addresses to import.",
						},
						selectedStablecoins: {
							type: "array",
							items: { type: "string" },
							description:
								"Optional explicit stablecoin symbols to deploy and seed.",
						},
						forceRefresh: {
							type: "boolean",
							description: "Force a fresh GeckoTerminal fetch.",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "extension_capability_map",
				description:
					"Map VS Code extension command families to MCP tools, showing what is fully MCP-supported " +
					"and what remains UI-only.",
				inputSchema: { type: "object", properties: {} },
			},
			{
				name: "agent_workspace_context",
				description:
					"Describe current MCP runtime workspace context (cwd, detected compose files, resolved compose target). " +
					"Use this first when agents run inside project-example to avoid root-repo assumptions.",
				inputSchema: {
					type: "object",
					properties: {
						composeFile: {
							type: "string",
							description: "Optional explicit compose file override",
						},
					},
				},
			},
			{
				name: "agent_tool_contracts",
				description:
					"Return machine-readable tool reliability metadata (idempotency, side effects, and suggested usage order) for agent planning.",
				inputSchema: { type: "object", properties: {} },
			},
			{
				name: "agent_operation_get",
				description: "Get one operation record by operation id.",
				inputSchema: {
					type: "object",
					required: ["operationId"],
					properties: {
						operationId: { type: "string" },
					},
				},
			},
			{
				name: "agent_operations_recent",
				description:
					"List recent operation records for observability and debugging.",
				inputSchema: {
					type: "object",
					properties: {
						limit: {
							type: "number",
							description: "Max operations to return (default: 20)",
						},
					},
				},
			},
			{
				name: "agent_runbook_execute",
				description:
					"Execute guided multi-step workflows for local stack operations with explicit readiness checks. " +
					"Runbooks: local_stack_doctor, local_bootstrap_token_deploy.",
				inputSchema: {
					type: "object",
					required: ["runbook"],
					properties: {
						runbook: {
							type: "string",
							enum: ["local_stack_doctor", "local_bootstrap_token_deploy"],
						},
						name: {
							type: "string",
							description:
								"Bootstrap preset for token deploy runbook (default: ERC20Base)",
						},
						args: {
							type: "array",
							items: {},
							description: "Constructor args for bootstrap deploy runbook",
						},
						chain: {
							type: "string",
							enum: ["evm", "core"],
							description: "Target chain (default: evm)",
						},
						accountIndex: {
							type: "number",
							description: "Signer account index (default: 0)",
						},
						composeFile: { type: "string" },
						rpcUrl: {
							type: "string",
							description: "eSpace RPC URL (default: http://localhost:8545)",
						},
						chainId: {
							type: "number",
							description: "eSpace chain ID (default: 2030)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "local_stack_status",
				description:
					"Aggregate readiness report for the full local dev stack: Docker, Compose services, " +
					"conflux-devkit server, keystore, node, and DEX deployment status. " +
					"Returns a recommended nextStep action to unblock the workflow.",
				inputSchema: {
					type: "object",
					properties: {
						composeFile: {
							type: "string",
							description:
								"Path to docker-compose.yml (default: docker-compose.yml in workspace root)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
						rpcUrl: {
							type: "string",
							description:
								"eSpace RPC URL for DEX checks (default: http://localhost:8545)",
						},
						chainId: {
							type: "number",
							description: "eSpace chain ID for DEX checks (default: 2030)",
						},
					},
				},
			},
			// ── Project layer (package.json scripts + dev server) ───────────────────
			// Maps to the VS Code extension's "Project" status-bar menu functionality.
			// These tools read/validate the workspace package.json and run npm/pnpm scripts,
			// equivalent to what a developer does via the statusbar "Project" menu in VS Code.
			{
				name: "project_info",
				description:
					"Read the workspace project metadata: package.json name/version, available scripts, " +
					"whether node_modules are installed, and which devkit configuration settings are active. " +
					'Maps to the extension\'s "Project Doctor" script detection logic. ' +
					"Use this FIRST when working with a project-example workspace to understand what scripts exist " +
					"before trying to run them.",
				inputSchema: {
					type: "object",
					properties: {
						cwd: {
							type: "string",
							description:
								"Absolute path to the project root (default: agent workspace root)",
						},
					},
				},
			},
			{
				name: "project_doctor",
				description:
					'Run a full project health check equivalent to the extension\'s "Project Doctor" command. ' +
					"Checks: (1) node_modules installed, (2) required package.json scripts present, " +
					"(3) deployed contracts reachable from the selected network's RPC, " +
					"(4) contracts-addresses artifact present. " +
					"Returns a checklist of ok/warn/error items and a summary. " +
					"Run this before deploy or dev-start to surface script or artifact gaps. " +
					"NOTE: This tool only performs static checks; it does NOT run the project's own doctor script " +
					"(use project_script_run for that).",
				inputSchema: {
					type: "object",
					properties: {
						cwd: {
							type: "string",
							description: "Absolute path to the project root",
						},
						espaceRpc: {
							type: "string",
							description:
								"eSpace RPC URL for contract reachability checks (default: http://127.0.0.1:8545)",
						},
						chainId: {
							type: "number",
							description:
								"eSpace chain ID for artifact address matching (default: 2030 for local)",
						},
						port: {
							type: "number",
							description:
								"conflux-devkit port for deployed contracts query (default: 7748)",
						},
					},
				},
			},
			{
				name: "project_script_run",
				description:
					"Run a package.json script in the project workspace directory. " +
					"Use project_info first to see which scripts are available. " +
					'This is the equivalent of the extension\'s "Project: Deploy Contracts", ' +
					'"Project: Install dependencies", "Project: Clean workspace" menu items. ' +
					"Streams stdout/stderr as captured output. " +
					"Common scripts to know about: " +
					'"deploy" — deploy contracts to the selected network, ' +
					'"dev" — start dev environment, ' +
					'"doctor" — project health check, ' +
					'"clean" — remove node_modules + generated files, ' +
					'"stack:up/down/status/logs/rebuild" — production Docker Compose lifecycle.',
				inputSchema: {
					type: "object",
					required: ["script"],
					properties: {
						script: {
							type: "string",
							description:
								'package.json script name to run (e.g. "deploy", "dev", "doctor", "stack:up")',
						},
						cwd: {
							type: "string",
							description: "Absolute path to the project root",
						},
						env: {
							type: "object",
							description:
								"Additional environment variables to pass to the script (e.g. DEVKIT_NETWORK, DEPLOY_RPC_URL)",
							additionalProperties: { type: "string" },
						},
						timeoutMs: {
							type: "number",
							description:
								"Timeout in milliseconds (default: 60000). Use longer values for deploy/build scripts.",
						},
					},
				},
			},
			{
				name: "project_dev_server_status",
				description:
					"Check whether the project's dev server and/or production preview server are running " +
					"by probing their HTTP ports. " +
					'Maps to the extension\'s status bar "dev" / "production" / "stopped" state. ' +
					"Returns: devRunning (bool), prodRunning (bool), devPort, prodPort.",
				inputSchema: {
					type: "object",
					properties: {
						devPort: {
							type: "number",
							description: "Dev server port to probe (default: 3001)",
						},
						prodPort: {
							type: "number",
							description: "Production server port to probe (default: 3030)",
						},
					},
				},
			},
			// ── Conflux node tools ──────────────────────────────────────────────────
			// ════════════════════════════════════════════════════════════════════════
			// Cold-start lifecycle:
			//   conflux_server_start → conflux_status → conflux_setup_init → conflux_node_start → deploy
			// ════════════════════════════════════════════════════════════════════════
			{
				name: "conflux_server_start",
				description:
					"Start the conflux-devkit background server if it is not already running. " +
					"ALWAYS call this first when conflux_status reports the server offline. " +
					"Spawns the server as a detached background process and polls up to 30 s for it to be ready. " +
					"After success, call conflux_status to continue the setup lifecycle.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "Port for conflux-devkit server (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_status",
				description:
					"ALWAYS call this first before any other conflux_* tool. " +
					"Full lifecycle readiness check: server online, keystore initialized/unlocked, node running. " +
					"Returns a `nextStep` field — READ IT and follow it exactly. " +
					'If nextStep says "Ready" (or is empty): the stack is FULLY UP — do NOT call conflux_node_start. ' +
					'If nextStep says "Run conflux_node_start": node is stopped, call conflux_node_start. ' +
					'If nextStep says "Run conflux_setup_init": keystore uninitialized, call conflux_setup_init. ' +
					'If nextStep says "Run conflux_keystore_unlock": keystore locked, call conflux_keystore_unlock. ' +
					"Lifecycle order: conflux_server_start → conflux_setup_init → conflux_node_start → deploy contracts.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_node_status",
				description:
					"Get the current Conflux node status (state, RPC URLs, accounts, mining). " +
					"Use conflux_status instead if you are unsure whether the server or keystore is ready.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			// ── Keystore lifecycle (must complete before starting node) ─────────────
			{
				name: "conflux_setup_init",
				description:
					"Complete first-time keystore setup using the standard devkit test mnemonic. " +
					"Uses the well-known development mnemonic: " +
					'"test test test test test test test test test test test junk". ' +
					"This gives deterministic, reproducible accounts — the same on every fresh install. " +
					"PREREQUISITE: conflux-devkit server must be running. " +
					"WHEN TO USE: call when conflux_status reports keystore not initialized. " +
					"After this, call conflux_node_start to start the blockchain node. " +
					"DO NOT use this mnemonic on mainnet or testnet.",
				inputSchema: {
					type: "object",
					properties: {
						label: {
							type: "string",
							description: 'Wallet label (default: "Default")',
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_keystore_status",
				description:
					"Check keystore initialization and lock state. " +
					"Returns: initialized (bool), locked (bool), encryptionEnabled (bool). " +
					"If not initialized → call conflux_setup_init. " +
					"If locked → call conflux_keystore_unlock.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_keystore_unlock",
				description:
					"Unlock an encrypted keystore with the stored password. " +
					"Required when conflux_keystore_status returns locked=true. " +
					"After unlocking, call conflux_node_start.",
				inputSchema: {
					type: "object",
					required: ["password"],
					properties: {
						password: { type: "string", description: "Keystore password" },
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_keystore_lock",
				description:
					"Lock the active keystore. Useful before exporting logs or after privileged actions.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_wallets",
				description:
					"List all configured wallet mnemonics (summaries only, no private keys).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_wallet_add",
				description:
					"Add a new HD wallet (mnemonic) to the keystore. " +
					"Optionally set it immediately as the active wallet. " +
					'The standard devkit test mnemonic is: "test test test test test test test test test test test junk".',
				inputSchema: {
					type: "object",
					required: ["mnemonic", "label"],
					properties: {
						mnemonic: {
							type: "string",
							description: "BIP-39 mnemonic phrase (12 or 24 words)",
						},
						label: {
							type: "string",
							description: "Human-readable label for this wallet",
						},
						setAsActive: {
							type: "boolean",
							description: "Activate this wallet immediately (default: false)",
						},
						accountsCount: {
							type: "number",
							description:
								"Number of accounts to derive (default: backend setting)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_wallet_activate",
				description:
					"Set a wallet as the active wallet by its ID. Use conflux_wallets to list IDs.",
				inputSchema: {
					type: "object",
					required: ["id"],
					properties: {
						id: {
							type: "string",
							description: "Wallet ID from conflux_wallets",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_wallet_delete",
				description:
					"Delete a wallet from the keystore by its ID. Use conflux_wallets to list IDs.",
				inputSchema: {
					type: "object",
					required: ["id"],
					properties: {
						id: {
							type: "string",
							description: "Wallet ID from conflux_wallets",
						},
						deleteData: {
							type: "boolean",
							description: "Also delete persisted key data (default: false)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_wallet_rename",
				description:
					"Rename a wallet label by its ID. Use conflux_wallets to list IDs.",
				inputSchema: {
					type: "object",
					required: ["id", "label"],
					properties: {
						id: {
							type: "string",
							description: "Wallet ID from conflux_wallets",
						},
						label: { type: "string", description: "New label for the wallet" },
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			// ── Node lifecycle ───────────────────────────────────────────────────────
			{
				name: "conflux_node_start",
				description:
					"Start the local Conflux development node (Core Space + eSpace). " +
					'IMPORTANT: only call this when conflux_status nextStep explicitly says "Run conflux_node_start". ' +
					"If the node is already running this tool returns success immediately — it is safe to call idempotently. " +
					"PREREQUISITE: server must be running AND keystore must be initialized and unlocked. " +
					'If you get "Setup not completed" error, call conflux_setup_init first. ' +
					"Returns RPC URLs: Core=:12537 (chainId=2029), eSpace=:8545 (chainId=2030). " +
					"10 genesis accounts are pre-funded with 1,000,000 CFX each.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_node_stop",
				description:
					"Stop the local Conflux development node. Blockchain data is preserved.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_node_restart",
				description:
					"Restart the Conflux node (stop + start). Preserves all blockchain state. " +
					"If restart fails (node unresponsive), use conflux_node_wipe_restart instead.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_node_wipe_restart",
				description:
					"TROUBLESHOOTING: Wipe all blockchain data and restart the node fresh. " +
					"Use this when: node fails to start, RPC is unresponsive, state is corrupted, " +
					"or you want a clean slate. " +
					"⚠️  All deployed contracts and transaction history are lost. " +
					"✓  Mnemonic and account addresses are preserved (same keys, fresh balances). " +
					"After this, the node is running with 10 freshly funded genesis accounts.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_node_wipe",
				description:
					"Stop the Conflux node and wipe blockchain data WITHOUT restarting. " +
					"Use when you want to manually control when the node restarts. " +
					"Call conflux_node_start afterwards to bring it back up fresh.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			// ── Network & accounts ───────────────────────────────────────────────────
			{
				name: "conflux_network_current",
				description:
					"Get current backend network mode selection (local/public), active chain IDs, and RPC settings.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_network_capabilities",
				description: "Get backend network capability flags for current mode.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_network_config_get",
				description:
					"Get backend network config (chain IDs, RPC ports, account count).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_network_config_set",
				description:
					"Set backend local network config values (chain IDs, ports, account count).",
				inputSchema: {
					type: "object",
					properties: {
						chainId: { type: "number" },
						evmChainId: { type: "number" },
						coreRpcPort: { type: "number" },
						evmRpcPort: { type: "number" },
						wsPort: { type: "number" },
						evmWsPort: { type: "number" },
						accounts: { type: "number" },
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_network_set",
				description:
					"Set backend network mode. " +
					'For mode="local", omit public config. ' +
					'For mode="public", provide coreRpcUrl and/or evmRpcUrl plus optional chain IDs.',
				inputSchema: {
					type: "object",
					required: ["mode"],
					properties: {
						mode: { type: "string", enum: ["local", "public"] },
						public: {
							type: "object",
							properties: {
								coreRpcUrl: { type: "string" },
								evmRpcUrl: { type: "string" },
								chainId: { type: "number" },
								evmChainId: { type: "number" },
							},
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_settings",
				description:
					"Read backend runtime settings (host, port, authEnabled, CORS and rate limits).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_rpc_urls",
				description:
					"Get the current RPC endpoint URLs for the Conflux dev node. " +
					"Returns Core Space and eSpace HTTP + WebSocket URLs, plus network config (chainIds, ports).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_accounts",
				description:
					"List all genesis accounts with BOTH Core Space (net2029:…) and eSpace (0x…) addresses plus live balances. " +
					"Output format: [index] Core: net2029:aa… eSpace: 0x… Balance: N CFX. " +
					"IMPORTANT: Core and eSpace are different addresses derived from the same private key. " +
					"Use the Core address for Core Space deploys/calls, eSpace address for eSpace. " +
					"Index 0 is the default deployer. Requires node running.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_fund_account",
				description:
					"Fund any address from the genesis faucet. " +
					"Auto-detects chain from address format: 0x → eSpace, base32 (net2029:…/cfxtest:…/cfx:…) → Core. " +
					"Requires the node to be running.",
				inputSchema: {
					type: "object",
					required: ["address"],
					properties: {
						address: {
							type: "string",
							description:
								"Core Space (cfx:...) or eSpace (0x...) address to fund",
						},
						amount: {
							type: "string",
							description: 'Amount in CFX (default: "100")',
						},
						chain: {
							type: "string",
							enum: ["core", "evm"],
							description:
								"Chain to fund on (auto-detected from address format if omitted)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_faucet_info",
				description:
					"Get the genesis faucet account addresses and current balances (Core Space and eSpace).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			// ── Mining ───────────────────────────────────────────────────────────────
			{
				name: "conflux_mining_status",
				description:
					"Get current auto-mining status (running/stopped, interval, blocks mined).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_mine",
				description:
					"Mine N blocks immediately on the local Conflux dev node. " +
					"Useful for advancing block height or confirming transactions.",
				inputSchema: {
					type: "object",
					properties: {
						blocks: {
							type: "number",
							description: "Number of blocks to mine (default: 1)",
						},
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_mining_start",
				description:
					"Start auto-mining at a given interval (useful for keeping the chain active).",
				inputSchema: {
					type: "object",
					properties: {
						intervalMs: {
							type: "number",
							description:
								"Auto-mining interval in milliseconds (default: 2000)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_mining_stop",
				description:
					"Stop auto-mining. Blocks will only be produced when explicitly mined.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			// ── Contract templates (compiler-based) ──────────────────────────────────
			{
				name: "conflux_templates",
				description:
					"List available built-in contract templates (compiled with solc). " +
					"Templates: Counter, SimpleStorage, TestToken, BasicNFT, Voting, Escrow, MultiSig, Registry. " +
					"For production-ready contracts (ERC20Base, MultiSigWallet, etc.), use conflux_bootstrap_catalog.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_deploy",
				description:
					"Deploy a built-in contract template to the local Conflux dev node. " +
					'Supports BOTH eSpace and Core Space — use chain="core" for Core Space deployment. ' +
					"Use conflux_templates to see available names. " +
					"Constructor args are auto-filled with sensible defaults when not provided: " +
					"uint256→0, address→deployer account (correct format per chain), string name→'MyToken', string symbol→'MTK'. " +
					"Address args auto-fill with 0x address on eSpace, base32 (net2029:…) on Core. " +
					"Counter and Registry need no args. SimpleStorage defaults initialValue to 0. " +
					"Deploy directly with just the name — no prepare step needed. " +
					"For production contracts (ERC20Base, MultiSigWallet, etc.) use conflux_bootstrap_deploy.",
				inputSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: {
							type: "string",
							description:
								"Template name: Counter, SimpleStorage, TestToken, BasicNFT, Voting, Escrow, MultiSigWallet, Registry",
						},
						args: {
							type: "array",
							description:
								"Constructor arguments (optional — sensible defaults are auto-filled when omitted). " +
								"Examples: SimpleStorage→[0], TestToken→[\"MyToken\",\"MTK\",1000000], Counter→[] (no args)",
							items: {},
						},
						chain: {
							type: "string",
							enum: ["evm", "core"],
							description:
								"Deploy to eSpace (evm) or Core Space (core). Default: evm",
						},
						accountIndex: {
							type: "number",
							description: "Genesis account index to deploy from (default: 0)",
						},
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_deploy_prepare",
				description:
					"Prepare and validate a built-in template deployment WITHOUT deploying. " +
					"Checks template existence and validates constructor argument count against the template ABI constructor schema.",
				inputSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: {
							type: "string",
							description:
								"Template name (e.g. Counter, TestToken, BasicNFT, MultiSigWallet)",
						},
						args: {
							type: "array",
							description:
								"Optional partial constructor arguments for validation",
							items: {},
						},
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contracts",
				description:
					"List all contracts deployed during this session (both templates and bootstrap).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit server port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contract_template_get",
				description:
					"Get a single built-in contract template including source, ABI, and bytecode.",
				inputSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string" },
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contract_get",
				description: "Get one tracked deployed contract by registry id.",
				inputSchema: {
					type: "object",
					required: ["id"],
					properties: {
						id: { type: "string" },
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contract_delete",
				description:
					"Delete one tracked deployed contract by registry id (does not affect chain state).",
				inputSchema: {
					type: "object",
					required: ["id"],
					properties: {
						id: { type: "string" },
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contracts_clear",
				description:
					"Clear all tracked deployed contracts from registry (does not affect chain state).",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contract_call",
				description:
					"Call a function on a deployed contract tracked in the registry. " +
					"Works for BOTH read-only (view/pure) and state-changing functions — the backend determines if it is a call or transaction. " +
					"Use conflux_contracts to list deployed contracts and get the ID. " +
					"Use conflux_contract_get to inspect the ABI and available function names. " +
					"For contracts not in the registry, use blockchain_espace_call_contract instead.",
				inputSchema: {
					type: "object",
					required: ["id", "functionName"],
					properties: {
						id: {
							type: "string",
							description:
								"Contract registry ID (from conflux_contracts or conflux_contract_get)",
						},
						functionName: {
							type: "string",
							description: "Name of the contract function to call",
						},
						args: {
							type: "array",
							items: {},
							description:
								"Function arguments in order (optional, default: [])",
						},
						accountIndex: {
							type: "number",
							description:
								"Genesis account index to send the transaction from (default: 0)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_contract_register",
				description:
					"Register an externally deployed contract in the devkit registry. " +
					"Use this to track contracts deployed outside the devkit (e.g. via Hardhat, Remix, or a script) " +
					"so they appear in conflux_contracts and can be called via conflux_contract_call. " +
					'Requires: name, address, chain ("evm" or "core"), chainId. ' +
					"Optionally provide abi for call support.",
				inputSchema: {
					type: "object",
					required: ["name", "address", "chain", "chainId"],
					properties: {
						name: {
							type: "string",
							description: "Human-readable contract name",
						},
						address: {
							type: "string",
							description:
								"Contract address: 0x… for eSpace, base32 for Core (net2029:… local, cfxtest:… testnet, cfx:… mainnet)",
						},
						chain: {
							type: "string",
							enum: ["evm", "core"],
							description: "Which chain the contract is deployed on",
						},
						chainId: {
							type: "number",
							description:
								"Chain ID (e.g. 2030 for local eSpace, 2029 for local Core)",
						},
						txHash: {
							type: "string",
							description: "Deployment transaction hash (optional)",
						},
						deployer: {
							type: "string",
							description: "Deployer address (optional)",
						},
						abi: {
							type: "array",
							items: {},
							description:
								"Contract ABI (optional, enables conflux_contract_call)",
						},
						constructorArgs: {
							type: "array",
							items: {},
							description: "Constructor arguments used at deploy (optional)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			// ── Bootstrap catalog (production-ready @cfxdevkit/dex-contracts) ────────────
			{
				name: "conflux_bootstrap_catalog",
				description:
					"List the production-ready bootstrap contract catalog from @cfxdevkit/dex-contracts. " +
					"Categories: tokens (ERC20Base, ERC721Base, ERC1155Base, WrappedCFX), " +
					"defi (StakingRewards, VestingSchedule, ERC4626Vault), " +
					"governance (MultiSigWallet, GovernorCore, RoleRegistry), " +
					"utils (PaymentSplitter, MerkleAirdrop, Create2Factory), mocks (MockPriceOracle). " +
					"Also lists Conflux precompiles (AdminControl, SponsorWhitelist, CrossSpaceCall) with fixed addresses.",
				inputSchema: {
					type: "object",
					properties: {
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_bootstrap_entry",
				description:
					"Get one bootstrap catalog preset with full deployment schema (constructor arg names/types/descriptions, " +
					"supported chains, deployability, ABI/bytecode availability). Use this before prepare/deploy for strict validation.",
				inputSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: {
							type: "string",
							description: "Catalog name (e.g. ERC20Base, MultiSigWallet)",
						},
						accountIndex: {
							type: "number",
							description:
								"Account index used for address placeholder defaults (default: 0)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_bootstrap_prepare",
				description:
					"Prepare and validate a bootstrap deployment WITHOUT deploying. " +
					"Checks preset name, chain compatibility, arg count, missing required args, and auto-fills safe defaults. " +
					"Returns ready=true only when deployment inputs are complete.",
				inputSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: {
							type: "string",
							description:
								"Catalog name (e.g. ERC20Base, MultiSigWallet, StakingRewards)",
						},
						args: {
							type: "array",
							description:
								"Optional partial constructor args; missing slots are validated/defaulted",
							items: {},
						},
						chain: {
							type: "string",
							enum: ["evm", "core"],
							description:
								"Target chain for compatibility checks. Default: evm",
						},
						accountIndex: {
							type: "number",
							description:
								"Genesis account index for default placeholder resolution (default: 0)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_bootstrap_deploy",
				description:
					"Deploy a production-ready contract from the bootstrap catalog. " +
					"Address-type args auto-fill with the deployer account. " +
					"Use conflux_bootstrap_catalog to list available contracts. " +
					"You can deploy directly with just the name — missing args are auto-filled where possible. " +
					"Supports both eSpace and Core Space.",
				inputSchema: {
					type: "object",
					required: ["name"],
					properties: {
						name: {
							type: "string",
							description:
								"Catalog name (e.g. ERC20Base, MultiSigWallet, StakingRewards, ERC721Base)",
						},
						args: {
							type: "array",
							description:
								"Constructor arguments (optional — address args auto-fill with correct format per chain: " +
								"0x on eSpace, base32 net2029:… on Core)",
							items: {},
						},
						chain: {
							type: "string",
							enum: ["evm", "core"],
							description:
								"Deploy to eSpace (evm) or Core Space (core). Default: evm",
						},
						accountIndex: {
							type: "number",
							description: "Genesis account index (default: 0)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			{
				name: "conflux_bootstrap_deploy_multi",
				description:
					"Deploy one bootstrap catalog contract to multiple chains in one workflow. " +
					"Address-type args are auto-filled with the correct format per chain " +
					"(eSpace uses 0x addresses, Core Space uses base32 net2029:… addresses). " +
					"If you provide explicit address args in `args`, use `chainArgs` to override " +
					"with the correct format per chain. " +
					"Returns per-chain success/failure details.",
				inputSchema: {
					type: "object",
					required: ["name", "chains"],
					properties: {
						name: {
							type: "string",
							description: "Catalog name (e.g. ERC20Base, StakingRewards)",
						},
						chains: {
							type: "array",
							items: { type: "string", enum: ["evm", "core"] },
							description:
								'Target chains in order (e.g. ["evm","core"])',
						},
						args: {
							type: "array",
							description:
								"Constructor arguments used for each chain unless chainArgs override is provided. " +
								"Address args are auto-filled per chain; omit address args to let auto-fill handle format differences.",
							items: {},
						},
						chainArgs: {
							type: "object",
							description:
								"Per-chain constructor args overrides. REQUIRED when you provide explicit address args that differ between chains. " +
								'Example: { "evm": ["0xAddr…"], "core": ["net2029:aa…"] }',
							properties: {
								evm: { type: "array", items: {} },
								core: { type: "array", items: {} },
							},
						},
						accountIndex: {
							type: "number",
							description:
								"Genesis account index for deploy transactions (default: 0)",
						},
						continueOnError: {
							type: "boolean",
							description:
								"Continue remaining chains if one chain fails (default: true)",
						},
						port: {
							type: "number",
							description: "conflux-devkit port (default: 7748)",
						},
					},
				},
			},
			// ── Blockchain interaction tools (@cfxdevkit/core) ────────────────────
			...blockchainToolDefinitions,
			// ── Solidity compiler + template tools ───────────────────────────────
			...compilerToolDefinitions,
		],
	}));

	// ── Tool handlers ─────────────────────────────────────────────────────────────

	server.setRequestHandler(CallToolRequestSchema, async (request) => {
		const { name, arguments: args } = request.params;
		const a = (args ?? {}) as Record<string, unknown>;
		const workspaceCtx = getWorkspaceContext(
			a.composeFile as string | undefined,
		);
		const composeOpts = { composeFile: workspaceCtx.composeFile };
		const devkitCfg: DevkitConfig = {
			port: resolveDevkitPort(workspaceCtx, a.port as number | undefined),
		};
		const devkitClient = new DevkitClient();

		try {
			// ── Compiler + template tools ──────────────────────────────────────────
			if (
				name.startsWith("cfxdevkit_compile") ||
				name === "cfxdevkit_list_templates" ||
				name === "cfxdevkit_get_template"
			) {
				const result = await compilerToolHandler(name, a);
				if (result) {
					return { content: [{ type: "text", text: result.text }] };
				}
			}

			// ── Blockchain tools (@cfxdevkit/core + keystore) ──────────────────────
			if (name.startsWith("blockchain_") || name.startsWith("cfxdevkit_")) {
				const result = await blockchainToolHandler(name, a);
				return {
					content: [{ type: "text", text: result.text }],
					isError: result.isError,
				};
			}

			const lifecycleResult = await handleConfluxLifecycleTool({
				name,
				args: a,
				devkitCfg,
				client: devkitClient,
			});
			if (lifecycleResult) {
				return lifecycleResult;
			}

			const keystoreResult = await handleConfluxKeystoreTool({
				name,
				args: a,
				devkitCfg,
				client: devkitClient,
			});
			if (keystoreResult) {
				return keystoreResult;
			}

			const networkResult = await handleConfluxNetworkTool({
				name,
				args: a,
				devkitCfg,
				client: devkitClient,
			});
			if (networkResult) {
				return networkResult;
			}

			const contractsResult = await handleConfluxContractsTool({
				name,
				args: a,
				devkitCfg,
				client: devkitClient,
				saveContract,
				deployCoreFromCatalogBytecode: async ({
					name: contractName,
					abi,
					bytecode,
					constructorArgs,
					accountIndex,
				}) => {
					const coreResult = await blockchainToolHandler(
						"blockchain_core_deploy_contract",
						{
							abi: JSON.stringify(abi),
							bytecode,
							contractName,
							constructorArgs,
							accountIndex,
						},
					);
					return { text: coreResult.text, isError: coreResult.isError };
				},
			});
			if (contractsResult) {
				return contractsResult;
			}

			switch (name) {
				// ── Docker Compose ────────────────────────────────────────────────────
				case "workspace_status": {
					const status = getComposeStatus(composeOpts);
					if (!status.services.length) {
						return {
							content: [
								{
									type: "text",
									text: "No services found. Is docker-compose.yml present and Docker running?",
								},
							],
						};
					}
					const lines = status.services.map(
						(s) =>
							`${s.state === "running" ? "✓" : "✗"} ${s.name.padEnd(20)} ${s.state}${s.ports ? `  (${s.ports})` : ""}`,
					);
					return { content: [{ type: "text", text: lines.join("\n") }] };
				}

				case "workspace_start": {
					const service = a.service as string | undefined;
					const output = runCompose(
						service ? ["up", "-d", service] : ["up", "-d"],
						composeOpts,
					);
					return {
						content: [
							{
								type: "text",
								text:
									output || `Services started${service ? `: ${service}` : ""}`,
							},
						],
					};
				}

				case "workspace_stop": {
					const service = a.service as string | undefined;
					const output = runCompose(
						service ? ["stop", service] : ["stop"],
						composeOpts,
					);
					return {
						content: [
							{
								type: "text",
								text:
									output || `Services stopped${service ? `: ${service}` : ""}`,
							},
						],
					};
				}

				case "workspace_logs": {
					const service = a.service as string | undefined;
					const lines = (a.lines as number | undefined) ?? 50;
					const output = runCompose(
						[
							"logs",
							"--no-color",
							`--tail=${lines}`,
							...(service ? [service] : []),
						],
						composeOpts,
					);
					return {
						content: [{ type: "text", text: output || "No logs available." }],
					};
				}

				case "docker_available": {
					const available = isDockerAvailable();
					return {
						content: [
							{
								type: "text",
								text: available
									? "Docker daemon is reachable."
									: "Docker daemon is NOT reachable. Check /var/run/docker.sock mount.",
							},
						],
					};
				}

				case "backend_api_catalog": {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(BACKEND_ENDPOINT_CATALOG, null, 2),
							},
						],
					};
				}

				case "backend_health": {
					const result = await devkitApiRequest({
						path: "/health",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "backend_api_call": {
					const op = startOperation(name, a);
					const path = (a.path as string | undefined)?.trim();
					if (!path) {
						finishOperation(op.id, "failed", "missing path");
						return {
							content: [
								{
									type: "text",
									text: `Error: backend_api_call requires \`path\`. operationId=${op.id}`,
								},
							],
							isError: true,
						};
					}

					const normalizedPath = path.startsWith("/") ? path : `/${path}`;
					if (
						!(
							normalizedPath === "/health" || normalizedPath.startsWith("/api/")
						)
					) {
						finishOperation(op.id, "failed", "invalid path");
						return {
							content: [
								{
									type: "text",
									text: `Error: path must be /health or start with /api/. operationId=${op.id}`,
								},
							],
							isError: true,
						};
					}

					const method = ((a.method as string | undefined)?.toUpperCase() ??
						"GET") as HttpMethod;
					if (!["GET", "POST", "PUT", "DELETE", "PATCH"].includes(method)) {
						finishOperation(op.id, "failed", "invalid method");
						return {
							content: [
								{
									type: "text",
									text: `Error: method must be one of GET, POST, PUT, DELETE. operationId=${op.id}`,
								},
							],
							isError: true,
						};
					}

					const port = (a.port as number | undefined) ?? 7748;
					addOperationStep(op.id, `${method} ${normalizedPath}`);
					const result = await devkitApiRequest({
						path: normalizedPath,
						method,
						body: a.body,
						port,
					});
					finishOperation(
						op.id,
						result.ok ? "succeeded" : "failed",
						result.ok ? undefined : `HTTP ${result.status}`,
					);
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										operationId: op.id,
										ok: result.ok,
										status: result.status,
										path: normalizedPath,
										method,
										data: result.json,
									},
									null,
									2,
								),
							},
						],
						isError: !result.ok,
					};
				}

				case "dex_manifest": {
					const result = await devkitApiRequest({
						path: "/api/dex/manifest",
						method: "GET",
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_translation_table": {
					const result = await devkitApiRequest({
						path: "/api/dex/translation-table",
						method: "GET",
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_wcfx_price": {
					const result = await devkitApiRequest({
						path: "/api/dex/pricing/wcfx-usd",
						method: "GET",
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_status": {
					const result = await devkitApiRequest({
						path: "/api/dex/status",
						method: "GET",
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_deploy": {
					const result = await devkitApiRequest({
						path: "/api/dex/deploy",
						method: "POST",
						body: {
							...(typeof a.accountIndex === "number"
								? { accountIndex: a.accountIndex }
								: {}),
						},
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_seed_from_gecko": {
					const body: Record<string, unknown> = {};
					if (typeof a.accountIndex === "number")
						body.accountIndex = a.accountIndex;
					if (Array.isArray(a.selectedPoolAddresses))
						body.selectedPoolAddresses = a.selectedPoolAddresses;
					if (Array.isArray(a.selectedStablecoins))
						body.selectedStablecoins = a.selectedStablecoins;
					if (typeof a.forceRefresh === "boolean")
						body.forceRefresh = a.forceRefresh;

					const result = await devkitApiRequest({
						path: "/api/dex/seed",
						method: "POST",
						body,
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "extension_capability_map": {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										note: "Extension capability map not available in minimal MCP server.",
									},
									null,
									2,
								),
							},
						],
					};
				}

				case "agent_workspace_context": {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										cwd: workspaceCtx.cwd,
										runtimeMode: workspaceCtx.runtimeMode,
										workspaceRoot: workspaceCtx.workspaceRoot,
										projectRoot: workspaceCtx.projectRoot,
										backendBaseUrl: workspaceCtx.backendBaseUrl,
										source: workspaceCtx.source,
										composeFileResolved: workspaceCtx.composeFile ?? null,
										composeCandidates: workspaceCtx.composeCandidates,
										guidance: isWorkspaceContainerContext(workspaceCtx)
											? "Workspace-container mode detected. Prefer backend and MCP workflows over compose-first assumptions."
											: "Repo-root mode detected. Pass composeFile explicitly when operating on project-example from the monorepo root.",
									},
									null,
									2,
								),
							},
						],
					};
				}

				case "agent_tool_contracts": {
					const contracts = {
						idempotent: [
							"backend_api_catalog",
							"extension_capability_map",
							"agent_tool_contracts",
							"agent_operation_get",
							"agent_operations_recent",
							"local_stack_status",
							"conflux_status",
							"conflux_keystore_status",
							"conflux_node_status",
							"conflux_mining_status",
							"conflux_deploy_prepare",
							"conflux_bootstrap_catalog",
							"conflux_bootstrap_entry",
							"conflux_bootstrap_prepare",
							"conflux_faucet_info",
							"conflux_wallets",
							"conflux_contracts",
							"conflux_contract_get",
							"dex_status",
							"dex_manifest",
							"dex_translation_table",
							"dex_wcfx_price",
							"dex_source_pools",
							"project_info",
							"project_doctor",
							"project_dev_server_status",
						],
						mutating: [
							"workspace_start",
							"workspace_stop",
							"conflux_server_start",
							"conflux_setup_init",
							"conflux_keystore_unlock",
							"conflux_keystore_lock",
							"conflux_wallet_add",
							"conflux_wallet_activate",
							"conflux_wallet_delete",
							"conflux_wallet_rename",
							"conflux_node_start",
							"conflux_node_stop",
							"conflux_node_restart",
							"conflux_node_wipe_restart",
							"conflux_node_wipe",
							"conflux_network_set",
							"conflux_network_config_set",
							"conflux_deploy",
							"conflux_bootstrap_deploy",
							"conflux_bootstrap_deploy_multi",
							"conflux_contract_call",
							"conflux_contract_register",
							"conflux_contract_delete",
							"conflux_contracts_clear",
							"conflux_fund_account",
							"conflux_mine",
							"conflux_mining_start",
							"conflux_mining_stop",
							"agent_runbook_execute",
							"dex_deploy",
							"dex_seed_from_gecko",
							"dex_reset",
							"project_script_run",
						],
						recommendedOrder: [
							"local_stack_status",
							"conflux_status",
							"conflux_deploy_prepare",
							"conflux_bootstrap_entry",
							"conflux_bootstrap_prepare",
							"conflux_bootstrap_deploy",
							"conflux_bootstrap_deploy_multi",
						],
					};
					return {
						content: [
							{ type: "text", text: JSON.stringify(contracts, null, 2) },
						],
					};
				}

				case "agent_operation_get": {
					const id = a.operationId as string;
					const operation = id ? getOperation(id) : null;
					if (!operation) {
						return {
							content: [
								{
									type: "text",
									text: `Operation not found: ${id ?? "(missing id)"}`,
								},
							],
							isError: true,
						};
					}
					return {
						content: [
							{ type: "text", text: JSON.stringify(operation, null, 2) },
						],
					};
				}

				case "agent_operations_recent": {
					const limit = (a.limit as number | undefined) ?? 20;
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(listOperations(limit), null, 2),
							},
						],
					};
				}

				case "agent_runbook_execute": {
					const op = startOperation(name, a);
					const runbook = a.runbook as string;
					if (!runbook) {
						finishOperation(op.id, "failed", "missing runbook");
						return {
							content: [
								{
									type: "text",
									text: `Error: agent_runbook_execute requires runbook. operationId=${op.id}`,
								},
							],
							isError: true,
						};
					}
					const result = await executeRunbook({
						runbook,
						args: a,
						devkitCfg,
						composeOpts,
						workspaceCtx,
						devkitClient,
						operationId: op.id,
					});
					finishOperation(
						op.id,
						result.isError ? "failed" : "succeeded",
						result.isError ? result.text : undefined,
					);
					return {
						content: [
							{ type: "text", text: `${result.text}\noperationId=${op.id}` },
						],
						isError: result.isError,
					};
				}

				case "conflux_keystore_lock": {
					const result = await devkitApiRequest({
						path: "/api/keystore/lock",
						method: "POST",
						body: {},
						port: devkitCfg.port,
					});
					return {
						content: [
							{
								type: "text",
								text: result.ok
									? "Keystore locked."
									: `Failed to lock keystore: ${JSON.stringify(result.json)}`,
							},
						],
						isError: !result.ok,
					};
				}

				case "conflux_network_current": {
					const result = await devkitApiRequest({
						path: "/api/network/current",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result.json, null, 2),
							},
						],
						isError: !result.ok,
					};
				}

				case "conflux_network_capabilities": {
					const result = await devkitApiRequest({
						path: "/api/network/capabilities",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_network_config_get": {
					const result = await devkitApiRequest({
						path: "/api/network/config",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_network_config_set": {
					const payload: Record<string, unknown> = {};
					for (const k of [
						"chainId",
						"evmChainId",
						"coreRpcPort",
						"evmRpcPort",
						"wsPort",
						"evmWsPort",
						"accounts",
					]) {
						if (a[k] !== undefined) {
							payload[k] = a[k];
						}
					}
					const result = await devkitApiRequest({
						path: "/api/network/config",
						method: "PUT",
						body: payload,
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_network_set": {
					const payload: Record<string, unknown> = { mode: a.mode };
					if (a.public && typeof a.public === "object") {
						payload.public = a.public;
					}
					const result = await devkitApiRequest({
						path: "/api/network/current",
						method: "PUT",
						body: payload,
						port: devkitCfg.port,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result.json, null, 2),
							},
						],
						isError: !result.ok,
					};
				}

				case "conflux_settings": {
					const result = await devkitApiRequest({
						path: "/api/settings",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(result.json, null, 2),
							},
						],
						isError: !result.ok,
					};
				}

				case "conflux_contract_template_get": {
					const templateName = a.name as string;
					if (!templateName) {
						return {
							content: [{ type: "text", text: "Error: name is required." }],
							isError: true,
						};
					}
					const result = await devkitApiRequest({
						path: `/api/contracts/templates/${encodeURIComponent(templateName)}`,
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_contract_get": {
					const contractId = a.id as string;
					if (!contractId) {
						return {
							content: [{ type: "text", text: "Error: id is required." }],
							isError: true,
						};
					}
					const result = await devkitApiRequest({
						path: `/api/contracts/deployed/${encodeURIComponent(contractId)}`,
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_contract_delete": {
					const contractId = a.id as string;
					if (!contractId) {
						return {
							content: [{ type: "text", text: "Error: id is required." }],
							isError: true,
						};
					}
					const result = await devkitApiRequest({
						path: `/api/contracts/deployed/${encodeURIComponent(contractId)}`,
						method: "DELETE",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_contracts_clear": {
					const result = await devkitApiRequest({
						path: "/api/contracts/deployed",
						method: "DELETE",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_contract_call": {
					const contractId = a.id as string;
					if (!contractId) {
						return {
							content: [{ type: "text", text: "Error: id is required." }],
							isError: true,
						};
					}
					const functionName = a.functionName as string;
					if (!functionName) {
						return {
							content: [
								{ type: "text", text: "Error: functionName is required." },
							],
							isError: true,
						};
					}
					const body: Record<string, unknown> = { functionName };
					if (Array.isArray(a.args)) body.args = a.args;
					if (typeof a.accountIndex === "number")
						body.accountIndex = a.accountIndex;
					const result = await devkitApiRequest({
						path: `/api/contracts/${encodeURIComponent(contractId)}/call`,
						method: "POST",
						body,
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_contract_register": {
					const body: Record<string, unknown> = {
						name: a.name,
						address: a.address,
						chain: a.chain,
						chainId: a.chainId,
					};
					if (a.txHash !== undefined) body.txHash = a.txHash;
					if (a.deployer !== undefined) body.deployer = a.deployer;
					if (Array.isArray(a.abi)) body.abi = a.abi;
					if (Array.isArray(a.constructorArgs))
						body.constructorArgs = a.constructorArgs;
					const result = await devkitApiRequest({
						path: "/api/contracts/register",
						method: "POST",
						body,
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_faucet_info": {
					const result = await devkitApiRequest({
						path: "/api/accounts/faucet",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_mining_status": {
					const result = await devkitApiRequest({
						path: "/api/mining/status",
						method: "GET",
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_wallet_add": {
					const body: Record<string, unknown> = {
						mnemonic: a.mnemonic,
						label: a.label,
					};
					if (typeof a.setAsActive === "boolean")
						body.setAsActive = a.setAsActive;
					if (typeof a.accountsCount === "number")
						body.accountsCount = a.accountsCount;
					const result = await devkitApiRequest({
						path: "/api/keystore/wallets",
						method: "POST",
						body,
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_wallet_activate": {
					const walletId = a.id as string;
					if (!walletId) {
						return {
							content: [{ type: "text", text: "Error: id is required." }],
							isError: true,
						};
					}
					const result = await devkitApiRequest({
						path: `/api/keystore/wallets/${encodeURIComponent(walletId)}/activate`,
						method: "POST",
						body: {},
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_wallet_delete": {
					const walletId = a.id as string;
					if (!walletId) {
						return {
							content: [{ type: "text", text: "Error: id is required." }],
							isError: true,
						};
					}
					const result = await devkitApiRequest({
						path: `/api/keystore/wallets/${encodeURIComponent(walletId)}`,
						method: "DELETE",
						body: {
							deleteData:
								typeof a.deleteData === "boolean" ? a.deleteData : false,
						},
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "conflux_wallet_rename": {
					const walletId = a.id as string;
					if (!walletId) {
						return {
							content: [{ type: "text", text: "Error: id is required." }],
							isError: true,
						};
					}
					const result = await devkitApiRequest({
						path: `/api/keystore/wallets/${encodeURIComponent(walletId)}`,
						method: "PATCH",
						body: { label: a.label },
						port: devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_reset": {
					const result = await devkitApiRequest({
						path: "/api/dex/state",
						method: "DELETE",
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "dex_source_pools": {
					const result = await devkitApiRequest({
						path: "/api/dex/source-pools/suggestions",
						method: "GET",
						port: (a.port as number | undefined) ?? devkitCfg.port,
					});
					return {
						content: [
							{ type: "text", text: JSON.stringify(result.json, null, 2) },
						],
						isError: !result.ok,
					};
				}

				case "local_stack_status": {
					const docker = isDockerAvailable();
					const compose = docker ? getComposeStatus(composeOpts) : null;
					const fullStatus = await devkitClient
						.getStatus(devkitCfg)
						.catch(() => null);

					let nextStep = "Ready for deploys and interactions.";
					if (!fullStatus?.serverOnline) {
						nextStep = "Run conflux_server_start.";
					} else if (!docker && !isWorkspaceContainerContext(workspaceCtx)) {
						nextStep = "Start Docker daemon and re-run local_stack_status.";
					} else if (!fullStatus.keystoreStatus?.initialized) {
						nextStep = "Run conflux_setup_init.";
					} else if (fullStatus.keystoreStatus.locked) {
						nextStep = "Run conflux_keystore_unlock.";
					} else if (!fullStatus.nodeRunning) {
						nextStep = "Run conflux_node_start.";
					}

					const composeLines = compose?.services.length
						? compose.services.map(
								(s) =>
									`  ${s.state === "running" ? "✓" : "✗"} ${s.name}${s.ports ? ` (${s.ports})` : ""}`,
							)
						: [
								isWorkspaceContainerContext(workspaceCtx)
									? "  (compose visibility not required in workspace-container mode)"
									: "  (no compose services detected)",
							];

					return {
						content: [
							{
								type: "text",
								text: [
									"=== Local Stack Status ===",
									`Runtime mode: ${workspaceCtx.runtimeMode}`,
									`Workspace cwd: ${workspaceCtx.cwd}`,
									`Workspace root: ${workspaceCtx.workspaceRoot}`,
									`Backend: ${workspaceCtx.backendBaseUrl}`,
									`Compose file: ${composeOpts.composeFile ?? "(default docker-compose.yml not found in cwd)"}`,
									`Docker: ${docker ? "reachable" : "unreachable"}`,
									"Compose services:",
									...composeLines,
									`Conflux server: ${fullStatus?.serverOnline ? "online" : "offline"}`,
									`Keystore initialized: ${fullStatus?.keystoreStatus?.initialized ? "yes" : "no"}`,
									`Keystore locked: ${fullStatus?.keystoreStatus?.locked ? "yes" : "no"}`,
									`Node running: ${fullStatus?.nodeRunning ? "yes" : "no"}`,
									"",
									`nextStep: ${nextStep}`,
								].join("\n"),
							},
						],
						isError: !fullStatus?.serverOnline,
					};
				}

				case "project_info": {
					const cwd =
						(a.cwd as string | undefined) ??
						workspaceCtx.projectRoot ??
						workspaceCtx.cwd;
					const pkgPath = path.join(cwd, "package.json");
					const hasNodeModules = fs.existsSync(path.join(cwd, "node_modules"));

					let pkg: {
						name?: string;
						version?: string;
						scripts?: Record<string, string>;
					} = {};
					try {
						pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as typeof pkg;
					} catch {
						return {
							content: [
								{ type: "text", text: `No package.json found at ${cwd}` },
							],
							isError: true,
						};
					}

					const scripts = pkg.scripts ?? {};
					const scriptNames = Object.keys(scripts);

					const namedScripts: Record<string, string | null> = {};
					for (const k of [
						"doctor",
						"deploy",
						"dev",
						"clean",
						"install",
						"stack:up",
						"stack:down",
						"stack:rebuild",
						"stack:status",
						"stack:logs",
						"deps:install",
					]) {
						namedScripts[k] = k in scripts ? k : null;
					}

					const missingRecommended = [
						"deploy",
						"dev",
						"stack:up",
						"stack:down",
					].filter((k) => !namedScripts[k]);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										cwd,
										name: pkg.name,
										version: pkg.version,
										hasNodeModules,
										scripts: scriptNames,
										namedScripts,
										missingRecommendedScripts: missingRecommended,
										note:
											missingRecommended.length > 0
												? `⚠️  Missing scripts: ${missingRecommended.join(", ")}. Add them to package.json so project_script_run can execute them.`
												: "✓ All recommended scripts present.",
									},
									null,
									2,
								),
							},
						],
					};
				}

				case "project_doctor": {
					const cwd =
						(a.cwd as string | undefined) ??
						workspaceCtx.projectRoot ??
						workspaceCtx.cwd;
					const espaceRpc =
						(a.espaceRpc as string | undefined) ?? "http://127.0.0.1:8545";
					const chainId = (a.chainId as number | undefined) ?? 2030;

					const checks: Array<{
						key: string;
						level: "ok" | "warn" | "error";
						message: string;
					}> = [];

					checks.push(
						fs.existsSync(path.join(cwd, "node_modules"))
							? {
									key: "deps.installed",
									level: "ok",
									message: "Dependencies: node_modules present",
								}
							: {
									key: "deps.installed",
									level: "warn",
									message: "Dependencies missing — run install script",
								},
					);

					let scripts: Record<string, string> = {};
					try {
						const pkg = JSON.parse(
							fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
						) as { scripts?: Record<string, string> };
						scripts = pkg.scripts ?? {};
					} catch {
						checks.push({
							key: "pkg.json",
							level: "error",
							message: "No package.json found at cwd",
						});
					}

					for (const [scriptName, required] of [
						["deploy", true],
						["dev", true],
						["doctor", false],
						["clean", false],
						["stack:up", false],
						["stack:down", false],
						["stack:status", false],
						["stack:logs", false],
						["stack:rebuild", false],
					] as Array<[string, boolean]>) {
						checks.push(
							scriptName in scripts
								? {
										key: `script.${scriptName}`,
										level: "ok",
										message: `script "${scriptName}": found`,
									}
								: {
										key: `script.${scriptName}`,
										level: required ? "warn" : "ok",
										message: required
											? `script "${scriptName}": missing — add to package.json`
											: `script "${scriptName}": optional (not present)`,
									},
						);
					}

					const artifactCandidates = [
						path.join(cwd, "dapp/src/generated/contracts-addresses.ts"),
						path.join(cwd, "src/generated/contracts-addresses.ts"),
					];
					const artifactPath = artifactCandidates.find((p) => fs.existsSync(p));
					checks.push(
						artifactPath
							? {
									key: "contracts.artifact",
									level: "ok",
									message: `contracts-addresses.ts: ${artifactPath}`,
								}
							: {
									key: "contracts.artifact",
									level: "warn",
									message:
										"contracts-addresses.ts not found — run deploy script to generate it",
								},
					);

					try {
						const deployed = await devkitApiRequest({
							path: "/api/contracts/deployed",
							method: "GET",
							port: devkitCfg.port,
						});
						const evmContracts = (
							Array.isArray(deployed.json) ? deployed.json : []
						).filter((c: { chain?: string }) => c.chain === "evm");
						if (!evmContracts.length) {
							checks.push({
								key: "contracts.reachability",
								level: "warn",
								message: "No eSpace contracts in registry — deploy first",
							});
						} else {
							const addr =
								(evmContracts[0] as { address?: string }).address ?? "";
							try {
								const rpcRes = await fetch(espaceRpc, {
									method: "POST",
									headers: { "Content-Type": "application/json" },
									body: JSON.stringify({
										jsonrpc: "2.0",
										id: 1,
										method: "eth_getCode",
										params: [addr, "latest"],
									}),
									signal: AbortSignal.timeout(4_000),
								});
								const rpcJson = (await rpcRes.json()) as { result?: string };
								const code = rpcJson.result ?? "";
								checks.push(
									code && code !== "0x"
										? {
												key: "contracts.reachability",
												level: "ok",
												message: `Contract reachable at ${addr} (chainId ${chainId})`,
											}
										: {
												key: "contracts.reachability",
												level: "warn",
												message: `Contract bytecode empty at ${addr} — node not running or wrong chainId?`,
											},
								);
							} catch {
								checks.push({
									key: "contracts.reachability",
									level: "warn",
									message: `Could not reach eSpace RPC at ${espaceRpc}`,
								});
							}
						}
					} catch {
						checks.push({
							key: "contracts.reachability",
							level: "warn",
							message:
								"Could not query deployed contracts (devkit server offline?)",
						});
					}

					const warnCount = checks.filter((c) => c.level === "warn").length;
					const errorCount = checks.filter((c) => c.level === "error").length;
					const summary =
						errorCount > 0
							? `${errorCount} error(s), ${warnCount} warning(s)`
							: warnCount > 0
								? `${warnCount} warning(s)`
								: "✓ healthy";

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{ summary, warnCount, errorCount, cwd, checks },
									null,
									2,
								),
							},
						],
					};
				}

				case "project_script_run": {
					const cwd =
						(a.cwd as string | undefined) ??
						workspaceCtx.projectRoot ??
						workspaceCtx.cwd;
					const script = a.script as string;
					if (!script) {
						return {
							content: [{ type: "text", text: "Error: script is required." }],
							isError: true,
						};
					}

					let scripts: Record<string, string> = {};
					try {
						const pkg = JSON.parse(
							fs.readFileSync(path.join(cwd, "package.json"), "utf8"),
						) as { scripts?: Record<string, string> };
						scripts = pkg.scripts ?? {};
					} catch {
						return {
							content: [
								{ type: "text", text: `No package.json found at ${cwd}` },
							],
							isError: true,
						};
					}

					if (!(script in scripts)) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											error: `Script "${script}" not found in package.json`,
											availableScripts: Object.keys(scripts),
											hint: "Use project_info to see all available scripts, or add the missing script to package.json.",
										},
										null,
										2,
									),
								},
							],
							isError: true,
						};
					}

					const timeoutMs = (a.timeoutMs as number | undefined) ?? 60_000;
					const extraEnv = (a.env as Record<string, string> | undefined) ?? {};

					const output = await new Promise<string>((resolve) => {
						execFile(
							"pnpm",
							["run", script],
							{
								cwd,
								timeout: timeoutMs,
								env: { ...process.env, ...extraEnv },
								maxBuffer: 2 * 1024 * 1024,
							},
							(_err, out, stderr) =>
								resolve(
									[(out ?? "").trim(), (stderr ?? "").trim()]
										.filter(Boolean)
										.join("\n"),
								),
						);
					});

					return {
						content: [
							{
								type: "text",
								text: output || `Script "${script}" completed (no output).`,
							},
						],
					};
				}

				case "project_dev_server_status": {
					const devPort = (a.devPort as number | undefined) ?? 3001;
					const prodPort = (a.prodPort as number | undefined) ?? 3030;

					const probe = async (port: number): Promise<boolean> => {
						try {
							const r = await fetch(`http://127.0.0.1:${port}/`, {
								signal: AbortSignal.timeout(2_000),
							});
							return r.status < 500;
						} catch {
							return false;
						}
					};

					const [devRunning, prodRunning] = await Promise.all([
						probe(devPort),
						probe(prodPort),
					]);

					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										devRunning,
										devPort,
										devUrl: devRunning ? `http://127.0.0.1:${devPort}` : null,
										prodRunning,
										prodPort,
										prodUrl: prodRunning
											? `http://127.0.0.1:${prodPort}`
											: null,
										summary:
											devRunning && prodRunning
												? "dev+prod running"
												: devRunning
													? "dev running"
													: prodRunning
														? "prod running"
														: "all stopped",
									},
									null,
									2,
								),
							},
						],
					};
				}

				default:
					return {
						content: [{ type: "text", text: `Unknown tool: ${name}` }],
						isError: true,
					};
			}
		} catch (err) {
			return {
				content: [
					{
						type: "text",
						text: `Error: ${err instanceof Error ? err.message : String(err)}`,
					},
				],
				isError: true,
			};
		}
	});

	return server;
}
