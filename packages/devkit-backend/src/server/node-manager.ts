import { existsSync } from "node:fs";
import {
	access,
	constants,
	mkdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ServerConfig } from "@cfxdevkit/devnode";
import { ServerManager } from "@cfxdevkit/devnode";
import { getKeystoreService } from "@cfxdevkit/services";
import { contractStorage } from "./contract-storage.js";
import { clearDexRuntimeState } from "./routes/dex-runtime.js";
import { ConflictError, ServiceUnavailableError } from "./errors.js";
import { log } from "./logger.js";

/** Default local-devnet configuration */
function resolveDefaultAccountsCount(): number {
	const raw = process.env.CFXDEVKIT_ACCOUNTS_COUNT?.trim();
	if (!raw) return 5;
	const parsed = Number(raw);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : 5;
}

const DEFAULT_CONFIG: Omit<ServerConfig, "dataDir"> = {
	chainId: 2029, // Core Space — local devnet
	evmChainId: 2030, // eSpace  — local devnet
	coreRpcPort: 12537,
	evmRpcPort: 8545,
	wsPort: 12535,
	evmWsPort: 8546,
	log: false,
	accounts: resolveDefaultAccountsCount(),
};

/** Returns the data directory path for a given wallet ID. */
function walletDataDir(walletId: string): string {
	return join(homedir(), ".conflux-devkit", "wallets", walletId, "data");
}

function walletNetworkProfilePath(walletId: string): string {
	return join(
		homedir(),
		".conflux-devkit",
		"wallets",
		walletId,
		"network.json",
	);
}

const LOCAL_DEX_UI_STATE_PATHS = [
	join(process.cwd(), "apps", "dex-ui", "public", "pool-import-presets.json"),
	join(process.cwd(), "apps", "dex-ui", "public", "token-icon-overrides.json"),
	join(process.cwd(), "apps", "dex-ui", "public", "token-icons"),
];

export type NetworkMode = "local" | "public";

export interface PublicNetworkConfig {
	coreRpcUrl?: string;
	evmRpcUrl?: string;
	chainId?: number;
	evmChainId?: number;
}

export interface NetworkProfile {
	mode: NetworkMode;
	public: PublicNetworkConfig;
}

export interface ResolvedSigner {
	privateKey: `0x${string}`;
	source: "env" | "request" | "keystore";
	accountIndex: number;
}

/**
 * NodeManager wraps a single ServerManager instance.
 * It integrates with KeystoreService to provide the mnemonic and
 * persisted node config on startup.
 */
export class NodeManager {
	private manager: ServerManager | null = null;
	private config: Omit<ServerConfig, "dataDir"> = { ...DEFAULT_CONFIG };
	private networkProfile: NetworkProfile = { mode: "local", public: {} };

	private async syncWalletContext(walletId: string): Promise<void> {
		contractStorage.setDataDir(walletDataDir(walletId));

		const profilePath = walletNetworkProfilePath(walletId);
		if (!existsSync(profilePath)) {
			this.networkProfile = { mode: "local", public: {} };
			return;
		}

		try {
			const raw = await readFile(profilePath, "utf-8");
			const parsed = JSON.parse(raw) as Partial<NetworkProfile>;
			const mode = parsed.mode === "public" ? "public" : "local";
			const publicConfig = parsed.public ?? {};
			this.networkProfile = {
				mode,
				public: {
					coreRpcUrl: publicConfig.coreRpcUrl,
					evmRpcUrl: publicConfig.evmRpcUrl,
					chainId: publicConfig.chainId,
					evmChainId: publicConfig.evmChainId,
				},
			};
		} catch {
			this.networkProfile = { mode: "local", public: {} };
		}
	}

	private async persistNetworkProfile(walletId: string): Promise<void> {
		const path = walletNetworkProfilePath(walletId);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(
			path,
			JSON.stringify(this.networkProfile, null, 2),
			"utf-8",
		);
	}

	/** Called once at server start to load persisted state from the keystore. */
	async initialize(): Promise<void> {
		const keystore = getKeystoreService();
		await keystore.initialize();

		if (await keystore.isSetupCompleted()) {
			try {
				const active = await keystore.getActiveMnemonic();
				const nodeConfig = await keystore.getNodeConfig(active.id);
				if (nodeConfig) {
					this.config = { ...DEFAULT_CONFIG, ...nodeConfig };
				}
				await this.syncWalletContext(active.id);
			} catch (err) {
				log.warn(
					"No active mnemonic yet — keystore setup may not be complete",
					err,
				);
			}
		}

		log.info("NodeManager ready");
	}

	getManager(): ServerManager | null {
		return this.manager;
	}

	requireManager(): ServerManager {
		if (!this.manager)
			throw new ServiceUnavailableError("Node is not running. Start it first.");
		return this.manager;
	}

	isRunning(): boolean {
		return this.manager?.isRunning() ?? false;
	}

	getConfig(): Omit<ServerConfig, "dataDir"> {
		return { ...this.config };
	}

	getNetworkProfile(): NetworkProfile {
		return {
			mode: this.networkProfile.mode,
			public: { ...this.networkProfile.public },
		};
	}

	getEffectiveChainIds(): { chainId: number; evmChainId: number } {
		const profile = this.networkProfile;
		return {
			chainId: profile.public.chainId ?? this.config.chainId ?? 2029,
			evmChainId: profile.public.evmChainId ?? this.config.evmChainId ?? 2030,
		};
	}

	async setNetworkProfile(
		patch: Partial<NetworkProfile>,
	): Promise<NetworkProfile> {
		const nextMode = patch.mode ?? this.networkProfile.mode;
		if (nextMode !== "local" && this.isRunning()) {
			throw new Error(
				"Node is running. Stop it before switching to public mode.",
			);
		}

		this.networkProfile = {
			mode: nextMode,
			public: {
				...this.networkProfile.public,
				...(patch.public ?? {}),
			},
		};

		const keystore = getKeystoreService();
		if (await keystore.isSetupCompleted()) {
			const active = await keystore.getActiveMnemonic();
			contractStorage.setDataDir(walletDataDir(active.id));
			await this.persistNetworkProfile(active.id);
		}

		return this.getNetworkProfile();
	}

	updateConfig(partial: Partial<Omit<ServerConfig, "dataDir">>): void {
		this.config = { ...this.config, ...partial };
	}

	async resolveSignerForPublicMode(params: {
		chain: "core" | "evm";
		accountIndex?: number;
		requestPrivateKey?: string;
	}): Promise<ResolvedSigner> {
		const { chain, accountIndex = 0, requestPrivateKey } = params;

		const envChainKey =
			chain === "evm"
				? process.env.CFXDEVKIT_PUBLIC_EVM_PRIVATE_KEY
				: process.env.CFXDEVKIT_PUBLIC_CORE_PRIVATE_KEY;
		const envGenericKey = process.env.CFXDEVKIT_PUBLIC_PRIVATE_KEY;
		const envKey = envChainKey ?? envGenericKey;

		if (envKey) {
			return {
				privateKey: normalizePrivateKey(envKey),
				source: "env",
				accountIndex,
			};
		}

		if (requestPrivateKey) {
			return {
				privateKey: normalizePrivateKey(requestPrivateKey),
				source: "request",
				accountIndex,
			};
		}

		const keystore = getKeystoreService();
		if (!(await keystore.isSetupCompleted())) {
			throw new Error(
				"No signer available in public mode. Setup keystore or provide private key/env override.",
			);
		}

		const active = await keystore.getActiveMnemonic();
		const genesisAccounts = await keystore.deriveGenesisAccounts(active.id);
		const signer = genesisAccounts[accountIndex];
		if (!signer) {
			throw new Error(
				`Account index ${accountIndex} not found in active mnemonic.`,
			);
		}

		const privateKey =
			chain === "evm"
				? (signer.evmPrivateKey ?? signer.privateKey)
				: signer.privateKey;

		return {
			privateKey: normalizePrivateKey(privateKey),
			source: "keystore",
			accountIndex,
		};
	}

	async start(): Promise<void> {
		if (this.manager?.isRunning()) {
			throw new ConflictError("Node is already running.");
		}

		if (this.networkProfile.mode !== "local") {
			throw new ConflictError(
				"Current network mode is public. Switch to local mode before starting node.",
			);
		}

		const keystore = getKeystoreService();
		if (!(await keystore.isSetupCompleted())) {
			throw new ServiceUnavailableError(
				"Setup not completed. Configure a mnemonic first.",
			);
		}

		const active = await keystore.getActiveMnemonic();
		const mnemonic = await keystore.getDecryptedMnemonic(active.id);
		const dataDir = walletDataDir(active.id);

		// Pre-flight: check port availability
		const busyPorts = await checkRequiredPorts(this.config);
		if (busyPorts.length > 0) {
			const msg = `Port(s) already in use: ${busyPorts.join(", ")}. Another node instance may be running.`;
			log.error(msg);
			throw new ConflictError(msg);
		}

		// Ensure data directory exists and is writable
		try {
			await mkdir(dataDir, { recursive: true, mode: 0o755 });
			await access(dataDir, constants.W_OK);
		} catch (dirErr) {
			log.error(`Data directory not writable: ${dataDir}`, dirErr);
			throw new ServiceUnavailableError(
				`Data directory not accessible: ${dataDir}`,
			);
		}

		// Point contract storage at this wallet's directory before starting
		await this.syncWalletContext(active.id);

		const server = new ServerManager({ ...this.config, dataDir, mnemonic });
		log.info(
			`Starting Conflux devnode (dataDir=${dataDir}, chainId=${this.config.chainId}, evmChainId=${this.config.evmChainId}, coreRpc=${this.config.coreRpcPort}, evmRpc=${this.config.evmRpcPort})`,
		);
		try {
			await server.start();
		} catch (err) {
			log.error("Conflux devnode failed to start", err);
			throw err;
		}
		log.info("Conflux devnode started");
		this.manager = server;
	}

	async stop(): Promise<void> {
		if (this.manager) {
			await this.manager.stop();
			this.manager = null;
		}
	}

	async restart(): Promise<void> {
		await this.stop();
		await this.start();
	}

	/** Stop, wipe the active wallet's data directory (including contracts.json), then start fresh. */
	async restartWipe(): Promise<void> {
		await this.wipeData();
		await this.start();
	}

	/** Stop the node if running, then wipe the active wallet's data directory.  Does NOT restart. */
	async wipeData(): Promise<void> {
		const keystore = getKeystoreService();
		const active = await keystore.getActiveMnemonic();
		const dataDir = walletDataDir(active.id);
		await this.stop();
		// Clear in-memory contract storage before wiping
		await contractStorage.wipeFile();
		await clearDexRuntimeState().catch(() => undefined);
		await rm(dataDir, { recursive: true, force: true });
		for (const target of LOCAL_DEX_UI_STATE_PATHS) {
			await rm(target, { recursive: true, force: true }).catch(() => undefined);
		}
		log.info(`Wiped data directory: ${dataDir}`);
	}
}

function normalizePrivateKey(value: string): `0x${string}` {
	const trimmed = value.trim();
	const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
	if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) {
		throw new Error("Invalid private key format. Expected 32-byte hex string.");
	}
	return withPrefix as `0x${string}`;
}

/** Check if a TCP port is available for binding. */
function isPortAvailable(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const srv = createNetServer();
		srv.once("error", () => resolve(false));
		srv.once("listening", () => {
			srv.close(() => resolve(true));
		});
		srv.listen(port, "127.0.0.1");
	});
}

/** Check all required ports and return list of busy ones. */
async function checkRequiredPorts(
	config: Omit<ServerConfig, "dataDir">,
): Promise<number[]> {
	const ports = [
		config.coreRpcPort ?? 12537,
		config.evmRpcPort ?? 8545,
		config.wsPort ?? 12535,
		config.evmWsPort ?? 8546,
	];
	const results = await Promise.all(
		ports.map(async (p) => ({ port: p, free: await isPortAvailable(p) })),
	);
	return results.filter((r) => !r.free).map((r) => r.port);
}
