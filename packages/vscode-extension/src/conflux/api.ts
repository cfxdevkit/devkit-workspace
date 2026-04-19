/**
 * api.ts
 *
 * VS Code adapter for the conflux-devkit REST API.
 * All types are imported from @devkit/shared (single source of truth).
 * Port is resolved from VS Code workspace configuration.
 */

// Import types locally (compile-time only — erased at runtime)
import type {
	AccountInfo,
	BootstrapEntry,
	CompiledContract,
	CurrentNetwork,
	DeployedContract,
	KeystoreStatus,
	MiningStatus,
	NetworkCapabilities,
	NetworkConfig,
	NetworkMode,
	NodeStatus,
	PublicNetworkConfig,
	RpcUrls,
	TemplateInfo,
} from "@devkit/shared";
import * as vscode from "vscode";

// Re-export all types from shared — no duplication
export type {
	AccountInfo,
	BootstrapEntry,
	CompiledContract,
	CurrentNetwork,
	DeployedContract,
	KeystoreStatus,
	MiningStatus,
	NetworkCapabilities,
	NetworkConfig,
	NetworkMode,
	NodeStatus,
	PublicNetworkConfig,
	RpcUrls,
	TemplateInfo,
	WalletEntry,
} from "@devkit/shared";

// ── VS Code port resolver ──────────────────────────────────────────────────

function getBaseUrl(): string {
	const port =
		vscode.workspace.getConfiguration("cfxdevkit").get<number>("port") ?? 7748;
	return `http://127.0.0.1:${port}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
	const url = `${getBaseUrl()}${path}`;
	const res = await fetch(url, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
		signal: init?.signal ?? AbortSignal.timeout(10_000),
	});
	const body = (await res.json()) as T;
	if (!res.ok) {
		const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`;
		throw new Error(msg);
	}
	return body;
}

// ── Server health ──────────────────────────────────────────────────────────

export async function isServerOnline(): Promise<boolean> {
	try {
		const res = await fetch(`${getBaseUrl()}/health`, {
			signal: AbortSignal.timeout(2_000),
		});
		return res.ok;
	} catch {
		return false;
	}
}

// ── Keystore ───────────────────────────────────────────────────────────────

export async function getKeystoreStatus(): Promise<KeystoreStatus> {
	return apiFetch<KeystoreStatus>("/api/keystore/status");
}

export async function generateMnemonic(): Promise<string> {
	const res = await apiFetch<{ mnemonic: string }>("/api/keystore/generate", {
		method: "POST",
		body: "{}",
	});
	return res.mnemonic;
}

export async function setupKeystoreWallet(
	mnemonic: string,
	label = "Default",
	options?: { accountsCount?: number },
): Promise<void> {
	await apiFetch("/api/keystore/setup", {
		method: "POST",
		body: JSON.stringify({ mnemonic, label, ...(options ?? {}) }),
	});
}

export async function unlockKeystoreWallet(password: string): Promise<void> {
	await apiFetch("/api/keystore/unlock", {
		method: "POST",
		body: JSON.stringify({ password }),
	});
}

// ── Node lifecycle ─────────────────────────────────────────────────────────

export async function getNodeStatus(): Promise<NodeStatus> {
	return apiFetch<NodeStatus>("/api/node/status");
}

export async function startNode(): Promise<NodeStatus> {
	const res = await apiFetch<{ ok: boolean; status: NodeStatus }>(
		"/api/node/start",
		{
			method: "POST",
			body: "{}",
			signal: AbortSignal.timeout(75_000), // xcfx binary startup: up to 60s
		},
	);
	return res.status;
}

export async function stopNode(): Promise<void> {
	await apiFetch("/api/node/stop", { method: "POST", body: "{}" });
}

export async function restartNode(): Promise<NodeStatus> {
	const res = await apiFetch<{ ok: boolean; status: NodeStatus }>(
		"/api/node/restart",
		{
			method: "POST",
			body: "{}",
			signal: AbortSignal.timeout(75_000), // stop (<5s) + xcfx restart (up to 60s)
		},
	);
	return res.status;
}

export async function restartWipe(): Promise<NodeStatus> {
	const res = await apiFetch<{ ok: boolean; status: NodeStatus }>(
		"/api/node/restart-wipe",
		{
			method: "POST",
			body: "{}",
			signal: AbortSignal.timeout(90_000), // stop + wipe files + fresh xcfx init (can be slower)
		},
	);
	return res.status;
}

export async function wipe(): Promise<void> {
	await apiFetch("/api/node/wipe", {
		method: "POST",
		body: "{}",
		signal: AbortSignal.timeout(30_000), // stop + delete files only, no restart
	});
}

// ── Accounts ───────────────────────────────────────────────────────────────

export async function getAccounts(): Promise<AccountInfo[]> {
	return apiFetch<AccountInfo[]>("/api/accounts");
}

// ── Contracts ──────────────────────────────────────────────────────────────

export async function getContractTemplates(): Promise<TemplateInfo[]> {
	return apiFetch<TemplateInfo[]>("/api/contracts/templates");
}

export async function compileContract(
	source: string,
	contractName?: string,
): Promise<CompiledContract> {
	return apiFetch<CompiledContract>("/api/contracts/compile", {
		method: "POST",
		body: JSON.stringify({ source, contractName }),
		signal: AbortSignal.timeout(30_000),
	});
}

export async function deployTemplate(
	name: string,
	abi: unknown[],
	bytecode: string,
	args: unknown[],
	chain: "evm" | "core",
	signer?: {
		accountIndex?: number;
		privateKey?: string;
		rpcUrl?: string;
		chainId?: number;
	},
): Promise<DeployedContract> {
	return apiFetch<DeployedContract>("/api/contracts/deploy", {
		method: "POST",
		body: JSON.stringify({
			contractName: name,
			abi,
			bytecode,
			args,
			chain,
			accountIndex: 0,
			...(signer ?? {}),
		}),
		// deployEvm transport: 30s + packMine Core transport: 120s
		signal: AbortSignal.timeout(150_000),
	});
}

export async function getDeployedContracts(): Promise<DeployedContract[]> {
	return apiFetch<DeployedContract[]>("/api/contracts/deployed");
}

export async function registerDeployedContract(payload: {
	id?: string;
	name: string;
	address: string;
	chain: "evm" | "core";
	chainId: number;
	txHash?: string;
	deployer?: string;
	deployedAt?: string;
	abi?: unknown[];
	constructorArgs?: unknown[];
	metadata?: Record<string, unknown>;
}): Promise<DeployedContract> {
	return apiFetch<DeployedContract>("/api/contracts/register", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

// ── Network mode ───────────────────────────────────────────────────────────

export async function getCurrentNetwork(): Promise<CurrentNetwork> {
	return apiFetch<CurrentNetwork>("/api/network/current");
}

export async function setCurrentNetwork(payload: {
	mode?: NetworkMode;
	public?: PublicNetworkConfig;
}): Promise<CurrentNetwork> {
	return apiFetch<CurrentNetwork>("/api/network/current", {
		method: "PUT",
		body: JSON.stringify(payload),
	});
}

export async function getNetworkCapabilities(): Promise<NetworkCapabilities> {
	return apiFetch<NetworkCapabilities>("/api/network/capabilities");
}

export async function callDeployedContract(
	contractId: string,
	functionName: string,
	args: unknown[],
	accountIndex = 0,
	privateKey?: string,
): Promise<{
	success: boolean;
	result?: unknown;
	txHash?: string;
	blockNumber?: string;
	status?: string;
}> {
	return apiFetch(`/api/contracts/${encodeURIComponent(contractId)}/call`, {
		method: "POST",
		body: JSON.stringify({
			functionName,
			args,
			accountIndex,
			...(privateKey ? { privateKey } : {}),
		}),
		signal: AbortSignal.timeout(60_000),
	});
}

// ── DEX ────────────────────────────────────────────────────────────────────

export async function getDexStatus(): Promise<{ ok: boolean; text: string }> {
	return apiFetch<{ ok: boolean; text: string }>("/api/dex/status");
}

export async function dexDeploy(
	args?: Record<string, unknown>,
): Promise<{ ok: boolean; text: string }> {
	return apiFetch<{ ok: boolean; text: string }>("/api/dex/deploy", {
		method: "POST",
		body: JSON.stringify(args ?? {}),
		signal: AbortSignal.timeout(300_000),
	});
}

export async function dexSeed(args?: {
	selectedPoolAddresses?: string[];
	selectedStablecoins?: string[];
}): Promise<{ ok: boolean; text: string }> {
	return apiFetch<{ ok: boolean; text: string }>("/api/dex/seed", {
		method: "POST",
		body: JSON.stringify(args ?? {}),
		signal: AbortSignal.timeout(300_000),
	});
}

/**
 * Stream a DEX SSE endpoint. Calls `onLine` for each progress line,
 * then returns the final result text. Throws on server-side errors.
 */
export async function dexStream(
	path: "/api/dex/deploy-stream" | "/api/dex/seed-stream",
	args: Record<string, unknown>,
	onLine: (line: string) => void,
): Promise<string> {
	const url = `${getBaseUrl()}${path}`;
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(args),
		signal: AbortSignal.timeout(600_000),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => `HTTP ${res.status}`);
		throw new Error(text);
	}
	const reader = res.body?.getReader();
	if (!reader) throw new Error("No response body");
	const decoder = new TextDecoder();
	let buffer = "";
	let finalText = "";

	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const parts = buffer.split("\n\n");
		buffer = parts.pop() ?? "";
		for (const part of parts) {
			const dataLine = part.replace(/^data: /, "");
			if (!dataLine) continue;
			try {
				const msg = JSON.parse(dataLine) as {
					type: string;
					line?: string;
					text?: string;
					message?: string;
				};
				if (msg.type === "progress" && msg.line) onLine(msg.line);
				else if (msg.type === "done" && msg.text) finalText = msg.text;
				else if (msg.type === "error")
					throw new Error(msg.message ?? "Unknown server error");
			} catch (err) {
				if (err instanceof SyntaxError) continue; // Skip malformed SSE chunks
				throw err;
			}
		}
	}
	return finalText;
}

export async function getDexSeedPoolSuggestions(limit = 20): Promise<{
	suggestions: Array<{
		address: string;
		label: string;
		reserveUsd: number;
		volume24h: number;
	}>;
}> {
	return apiFetch(
		`/api/dex/source-pools/suggestions?limit=${encodeURIComponent(String(limit))}`,
	);
}

// ── Bootstrap catalog ──────────────────────────────────────────────────────

export async function getBootstrapCatalog(): Promise<BootstrapEntry[]> {
	return apiFetch<BootstrapEntry[]>("/api/bootstrap/catalog");
}

export async function getBootstrapEntry(name: string): Promise<BootstrapEntry> {
	return apiFetch<BootstrapEntry>(
		`/api/bootstrap/catalog/${encodeURIComponent(name)}`,
	);
}

export async function deployBootstrap(
	name: string,
	args: unknown[],
	chain: "evm" | "core",
	signer?: {
		accountIndex?: number;
		privateKey?: string;
		rpcUrl?: string;
		chainId?: number;
	},
): Promise<DeployedContract> {
	return apiFetch<DeployedContract>("/api/bootstrap/deploy", {
		method: "POST",
		body: JSON.stringify({
			name,
			args,
			chain,
			accountIndex: 0,
			...(signer ?? {}),
		}),
		// deployEvm transport: 30s + packMine Core transport: 120s
		signal: AbortSignal.timeout(150_000),
	});
}

// ── Mining ─────────────────────────────────────────────────────────────────

export async function mine(blocks: number): Promise<void> {
	await apiFetch("/api/mining/mine", {
		method: "POST",
		body: JSON.stringify({ blocks }),
	});
}

export async function getMiningStatus(): Promise<MiningStatus> {
	return apiFetch<MiningStatus>("/api/mining/status");
}

export async function startMining(intervalMs = 2000): Promise<MiningStatus> {
	const res = await apiFetch<{ ok: boolean; status: MiningStatus }>(
		"/api/mining/start",
		{
			method: "POST",
			body: JSON.stringify({ intervalMs }),
		},
	);
	return res.status;
}

export async function stopMining(): Promise<MiningStatus> {
	const res = await apiFetch<{ ok: boolean; status: MiningStatus }>(
		"/api/mining/stop",
		{
			method: "POST",
			body: "{}",
		},
	);
	return res.status;
}

// ── Funding ────────────────────────────────────────────────────────────────

export async function fundAccount(
	address: string,
	amount: string,
	chain?: "core" | "evm",
): Promise<{
	ok: boolean;
	txHash: string;
	confirmed: boolean;
	message: string;
}> {
	return apiFetch("/api/accounts/fund", {
		method: "POST",
		body: JSON.stringify({ address, amount, chain }),
		signal: AbortSignal.timeout(40_000),
	});
}

// ── RPC URLs & network config ──────────────────────────────────────────────

export async function getRpcUrls(): Promise<RpcUrls> {
	return apiFetch<RpcUrls>("/api/network/rpc-urls");
}

export async function getNetworkConfig(): Promise<NetworkConfig> {
	return apiFetch<NetworkConfig>("/api/network/config");
}
