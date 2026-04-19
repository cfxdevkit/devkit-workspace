/**
 * ContractStorageService — persists deployed contract records for the active
 * wallet under `<walletDataDir>/contracts.json` and synchronizes a repository
 * tracking file at `<workspace>/deployments/contracts.json`.
 *
 * The repository tracking file is the cross-network source used by runtime and
 * production flows, while wallet-local storage is kept for backward-compatibility.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { log } from "./logger.js";

export interface StoredContract {
	id: string; // e.g. "evm-1713000000000"
	name: string; // contract name as deployed
	address: string; // deployed address (0x… or cfx:…)
	chain: "evm" | "core";
	chainId: number;
	txHash: string;
	deployer: string; // deployer address
	deployedAt: string; // ISO timestamp
	abi: unknown[];
	constructorArgs: unknown[];
	/** Arbitrary extra data — used by external tools (MCP, DEX service) to attach
	 *  domain-specific metadata without requiring schema changes. Examples:
	 *  - UniswapV2Factory: { initCodeHash, rpcUrl, stables, wcfxPriceUsd }
	 *  - MirrorERC20 tokens: { realAddress, symbol, decimals, iconCached, mirroredAt }
	 */
	metadata?: Record<string, unknown>;
}

interface ContractsFile {
	version: 1;
	walletDataDir: string;
	contracts: StoredContract[];
	updatedAt: string;
}

interface RepositoryTrackingFile {
	version: number;
	updatedAt: string;
	networks: Record<
		string,
		{
			chainId: number;
			contracts: Record<
				string,
				{
					id?: string | null;
					address: string;
					txHash?: string | null;
					deployedAt?: string | null;
					deployer?: string | null;
					source?: string | null;
				}
			>;
		}
	>;
}

function contractIdentityKey(
	contract: Pick<StoredContract, "chain" | "chainId" | "name" | "address">,
): string {
	return `${contract.chain}:${contract.chainId}:${contract.name.toLowerCase()}:${contract.address.toLowerCase()}`;
}

function scoreContract(contract: StoredContract): number {
	let score = 0;
	if (Array.isArray(contract.abi) && contract.abi.length > 0) score += 100;
	if (contract.txHash) score += 10;
	if (contract.deployer) score += 5;
	const deployedAt = new Date(contract.deployedAt).getTime();
	if (Number.isFinite(deployedAt)) score += deployedAt / 1_000_000_000_000;
	return score;
}

function inferNetworkLabel(chainId: number): string {
	if (chainId === 2029 || chainId === 2030) return "local";
	if (chainId === 1 || chainId === 71) return "testnet";
	if (chainId === 1029 || chainId === 1030) return "mainnet";
	return `chain-${chainId}`;
}

function normalizeNetworkLabel(
	value: string | undefined,
	chainId: number,
): string {
	const raw = (value ?? "").trim().toLowerCase();
	if (!raw) return inferNetworkLabel(chainId);
	if (raw === "local" || raw === "local-espace" || raw === "local-core")
		return "local";
	if (
		raw === "testnet" ||
		raw === "conflux-testnet" ||
		raw === "espace-testnet"
	)
		return "testnet";
	if (
		raw === "mainnet" ||
		raw === "conflux-mainnet" ||
		raw === "espace-mainnet"
	)
		return "mainnet";
	if (raw.startsWith("chain-")) return raw;
	return inferNetworkLabel(chainId);
}

function inferChainFromChainId(chainId: number): "evm" | "core" {
	if (chainId === 2030 || chainId === 71 || chainId === 1030) return "evm";
	return "core";
}

function isWorkspaceRoot(dir: string | undefined): dir is string {
	if (!dir) return false;
	return (
		existsSync(join(dir, "package.json")) ||
		existsSync(join(dir, "pnpm-workspace.yaml")) ||
		existsSync(join(dir, "dapp"))
	);
}

function detectWorkspaceRoot(): string | null {
	const envCandidates = [
		process.env.CFXDEVKIT_WORKSPACE?.trim(),
		process.env.WORKSPACE?.trim(),
		process.env.PWD?.trim(),
	];

	for (const candidate of envCandidates) {
		if (isWorkspaceRoot(candidate)) return candidate;
	}

	const cwd = process.cwd();
	if (isWorkspaceRoot(cwd)) return cwd;

	for (const base of ["/workspaces", "/workspace"]) {
		if (base === "/workspace") {
			if (isWorkspaceRoot(base)) return base;
			continue;
		}

		if (!existsSync(base)) continue;
		try {
			for (const name of readdirSync(base)) {
				const candidate = join(base, name);
				if (isWorkspaceRoot(candidate)) return candidate;
			}
		} catch {
			// ignore detection errors and keep falling back
		}
	}

	return null;
}

class ContractStorageService {
	private dataDir: string | null = null;
	private contracts: Map<string, StoredContract> = new Map();
	private initialized = false;

	/** Call when a wallet's node starts so storage points to the right directory. */
	setDataDir(walletDataDir: string): void {
		if (this.dataDir !== walletDataDir) {
			this.dataDir = walletDataDir;
			this.contracts.clear();
			this.initialized = false;
		}
	}

	private get storagePath(): string {
		if (!this.dataDir)
			throw new Error("ContractStorageService: dataDir not set");
		return `${this.dataDir}/contracts.json`;
	}

	private get repositoryTrackingPath(): string {
		const explicit = process.env.CFXDEVKIT_DEPLOYMENTS_FILE?.trim();
		if (explicit) return explicit;

		const workspace = detectWorkspaceRoot();
		if (workspace) return join(workspace, "deployments", "contracts.json");

		return join(process.cwd(), "deployments", "contracts.json");
	}

	private readWalletContracts(): StoredContract[] {
		if (!this.dataDir || !existsSync(this.storagePath)) return [];

		try {
			const raw = readFileSync(this.storagePath, "utf-8");
			const file: ContractsFile = JSON.parse(raw);
			return Array.isArray(file.contracts) ? file.contracts : [];
		} catch (err) {
			log.error("ContractStorage: failed to read wallet contracts file", err);
			return [];
		}
	}

	private readRepositoryTrackedContracts(): StoredContract[] {
		if (!existsSync(this.repositoryTrackingPath)) return [];

		try {
			const raw = readFileSync(this.repositoryTrackingPath, "utf-8");
			const file = JSON.parse(raw) as RepositoryTrackingFile;
			const networks = file.networks ?? {};
			const tracked: StoredContract[] = [];

			for (const [networkName, network] of Object.entries(networks)) {
				const chainId = Number(network?.chainId);
				if (!Number.isFinite(chainId)) continue;
				const normalizedNetworkName = normalizeNetworkLabel(
					networkName,
					chainId,
				);

				// Local devnet contracts must come from wallet-scoped storage only.
				// If we re-import local entries from the workspace tracking file, a
				// stale `deployments/contracts.json` can resurrect contracts after the
				// node data was wiped or the container/image was rebuilt.
				if (normalizedNetworkName === "local") continue;

				const chain = inferChainFromChainId(chainId);
				const contracts = network?.contracts ?? {};
				for (const [name, entry] of Object.entries(contracts)) {
					if (!entry || typeof entry.address !== "string") continue;
					const trackedId =
						typeof entry.id === "string" && entry.id.trim().length > 0
							? entry.id
							: `tracked-${normalizedNetworkName}-${chainId}-${name}-${entry.address.toLowerCase()}`;
					tracked.push({
						id: trackedId,
						name,
						address: entry.address,
						chain,
						chainId,
						txHash: entry.txHash ?? "",
						deployer: entry.deployer ?? "",
						deployedAt: entry.deployedAt ?? new Date().toISOString(),
						abi: [],
						constructorArgs: [],
						metadata: {
							mode: normalizedNetworkName === "local" ? "local" : "public",
							source: entry.source ?? "repository-tracking",
							network: normalizedNetworkName,
							syncedFromRepository: true,
						},
					});
				}
			}

			return tracked;
		} catch (err) {
			log.error(
				"ContractStorage: failed to read repository tracking file",
				err,
			);
			return [];
		}
	}

	private syncFromRepositoryTracking(): void {
		const tracked = this.readRepositoryTrackedContracts();
		const trackedKeys = new Set<string>();

		for (const trackedContract of tracked) {
			const key = contractIdentityKey(trackedContract);
			trackedKeys.add(key);

			let existingId: string | null = null;
			for (const [id, contract] of this.contracts.entries()) {
				if (contractIdentityKey(contract) === key) {
					existingId = id;
					break;
				}
			}

			if (!existingId) {
				this.contracts.set(trackedContract.id, trackedContract);
				continue;
			}

			const existing = this.contracts.get(existingId);
			if (!existing) continue;

			const merged: StoredContract = {
				...existing,
				txHash: trackedContract.txHash || existing.txHash,
				deployer: trackedContract.deployer || existing.deployer,
				deployedAt: trackedContract.deployedAt || existing.deployedAt,
				metadata: {
					...(existing.metadata ?? {}),
					...(trackedContract.metadata ?? {}),
				},
			};
			this.contracts.set(existingId, merged);
		}

		for (const [id, contract] of this.contracts.entries()) {
			if (!contract.metadata?.syncedFromRepository) continue;
			if (!trackedKeys.has(contractIdentityKey(contract))) {
				this.contracts.delete(id);
			}
		}
	}

	private upsertWalletContractsIntoMemory(contracts: StoredContract[]): void {
		for (const contract of contracts) {
			this.contracts.set(contract.id, contract);
		}
	}

	private ensureLoaded(): void {
		if (!this.initialized) {
			this.contracts.clear();
			this.upsertWalletContractsIntoMemory(this.readWalletContracts());
			this.initialized = true;

			if (this.dataDir) {
				log.info(
					`ContractStorage: loaded ${this.contracts.size} wallet contracts from ${this.storagePath}`,
				);
			}
		}

		// Always pull latest repository tracking entries so runtime/prod changes
		// are reflected without restarting the backend.
		this.syncFromRepositoryTracking();
	}

	private saveRepositoryTracking(): void {
		const path = this.repositoryTrackingPath;
		const dir = dirname(path);
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

		const tracking: RepositoryTrackingFile = {
			version: 1,
			updatedAt: new Date().toISOString(),
			networks: {},
		};

		const sorted = Array.from(this.contracts.values()).sort(
			(a, b) =>
				new Date(a.deployedAt).getTime() - new Date(b.deployedAt).getTime(),
		);

		for (const contract of sorted) {
			const networkLabel = normalizeNetworkLabel(
				typeof contract.metadata?.network === "string"
					? contract.metadata.network
					: undefined,
				contract.chainId,
			);

			const network = tracking.networks[networkLabel] ?? {
				chainId: contract.chainId,
				contracts: {},
			};

			const existing = network.contracts[contract.name];
			const currentTs = new Date(contract.deployedAt).getTime();
			const existingTs = existing?.deployedAt
				? new Date(existing.deployedAt).getTime()
				: Number.NEGATIVE_INFINITY;

			if (!existing || currentTs >= existingTs) {
				network.contracts[contract.name] = {
					id: contract.id,
					address: contract.address,
					txHash: contract.txHash || null,
					deployedAt: contract.deployedAt,
					deployer: contract.deployer || null,
					source:
						typeof contract.metadata?.source === "string"
							? contract.metadata.source
							: contract.metadata?.mode === "local"
								? "devkit-local"
								: "devkit",
				};
			}

			tracking.networks[networkLabel] = network;
		}

		writeFileSync(path, `${JSON.stringify(tracking, null, 2)}\n`, "utf-8");
	}

	private save(): void {
		try {
			if (this.dataDir) {
				const dir = dirname(this.storagePath);
				if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

				const file: ContractsFile = {
					version: 1,
					walletDataDir: this.dataDir,
					contracts: Array.from(this.contracts.values()),
					updatedAt: new Date().toISOString(),
				};
				writeFileSync(this.storagePath, JSON.stringify(file, null, 2), "utf-8");
			}

			this.saveRepositoryTracking();
		} catch (err) {
			log.error("ContractStorage: failed to save contracts file", err);
			throw err;
		}
	}

	add(contract: StoredContract): StoredContract {
		this.ensureLoaded();
		this.contracts.set(contract.id, contract);
		this.save();
		log.info(
			`ContractStorage: saved ${contract.name} at ${contract.address} (${contract.chain})`,
		);
		return contract;
	}

	list(chain?: "evm" | "core"): StoredContract[] {
		this.ensureLoaded();
		const all = Array.from(this.contracts.values());
		const filtered = chain ? all.filter((c) => c.chain === chain) : all;
		const deduped = new Map<string, StoredContract>();

		for (const contract of filtered) {
			const key = contractIdentityKey(contract);
			const existing = deduped.get(key);
			if (!existing || scoreContract(contract) >= scoreContract(existing)) {
				deduped.set(key, contract);
			}
		}

		return Array.from(deduped.values()).sort(
			(a, b) =>
				new Date(b.deployedAt).getTime() - new Date(a.deployedAt).getTime(),
		);
	}

	get(id: string): StoredContract | undefined {
		this.ensureLoaded();
		return this.contracts.get(id);
	}

	delete(id: string): boolean {
		this.ensureLoaded();
		const deleted = this.contracts.delete(id);
		if (deleted) this.save();
		return deleted;
	}

	clear(): void {
		this.ensureLoaded();
		this.contracts.clear();
		this.save();
	}

	/** Wipe the contracts.json file entirely (called from restartWipe). */
	async wipeFile(): Promise<void> {
		this.contracts.clear();
		this.initialized = false;
		if (this.dataDir) {
			await rm(this.storagePath, { force: true });
		}
		await rm(this.repositoryTrackingPath, { force: true });
	}
}

// Singleton
export const contractStorage = new ContractStorageService();
