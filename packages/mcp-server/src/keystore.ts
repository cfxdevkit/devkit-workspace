/**
 * keystore.ts — reads the conflux-devkit keystore directly
 *
 * The conflux-devkit stores its keystore at:
 *   ~/.devkit.keystore.json    (default)
 *   $DEVKIT_KEYSTORE_PATH      (override)
 *
 * This module uses the same file/schema as @cfxdevkit/services KeystoreService,
 * so the MCP server and conflux-devkit always share the same accounts.
 *
 * Plaintext keystores (encryptionEnabled: false) are read directly.
 * Encrypted keystores require the password to be provided via
 * DEVKIT_KEYSTORE_PASSWORD env var (set automatically by conflux-devkit on unlock).
 *
 * Core Space address format depends on chainId:
 *   2029  → net2029:aa…   (local devkit)
 *   1     → cfxtest:aa…  (testnet)
 *   1029  → cfx:aa…      (mainnet)
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Keystore schema (same as @cfxdevkit/services KeystoreV2) ─────────────────

interface DerivedAccount {
	index: number;
	core: string; // Core Space address (net2029:aa… / cfxtest:aa… / cfx:aa…)
	evm: string; // eSpace address (0x…)
	privateKey: string; // Core Space private key (0x…)
	evmPrivateKey: string; // eSpace private key (0x…)
}

interface NodeConfig {
	accountsCount: number;
	chainId: number;
	evmChainId: number;
	miningAuthor: "auto" | string;
	immutable: boolean;
}

interface DerivedKeys {
	type: "plaintext" | "encrypted";
	genesisAccounts: DerivedAccount[] | string; // array if plaintext, base64 if encrypted
	faucetAccount: DerivedAccount | string;
}

interface MnemonicEntry {
	id: string;
	label: string;
	type: "plaintext" | "encrypted";
	mnemonic: string; // plaintext or encrypted base64
	nodeConfig: NodeConfig;
	derivedKeys: DerivedKeys;
}

interface KeystoreV2 {
	version: 2;
	setupCompleted: boolean;
	encryptionEnabled: boolean;
	encryptionSalt?: string;
	mnemonics: MnemonicEntry[];
	activeIndex: number;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface AccountInfo {
	index: number;
	coreAddress: string;
	evmAddress: string;
	/** Only available when keystore is not encrypted */
	corePrivateKey?: string;
	evmPrivateKey?: string;
}

export interface NodeConfigInfo {
	chainId: number;
	evmChainId: number;
	accountsCount: number;
	coreAddressPrefix: string; // 'net2029' | 'cfxtest' | 'cfx'
	networkName: string; // 'local' | 'testnet' | 'mainnet' | 'custom'
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const KEYSTORE_PATH =
	process.env.DEVKIT_KEYSTORE_PATH ?? join(homedir(), ".devkit.keystore.json");

const CORE_NETWORK_NAMES: Record<number, string> = {
	2029: "local",
	1: "testnet",
	1029: "mainnet",
};

const CORE_ADDRESS_PREFIXES: Record<number, string> = {
	2029: "net2029",
	1: "cfxtest",
	1029: "cfx",
};

function loadKeystore(): KeystoreV2 {
	if (!existsSync(KEYSTORE_PATH)) {
		throw new Error(
			`Keystore not found at ${KEYSTORE_PATH}. ` +
				'Run "Conflux: Initialize Wallet" in the extension or run conflux-devkit.',
		);
	}
	const raw = readFileSync(KEYSTORE_PATH, "utf-8");
	const ks = JSON.parse(raw) as KeystoreV2;
	if (ks.version !== 2) {
		throw new Error(`Unsupported keystore version: ${ks.version}. Expected 2.`);
	}
	return ks;
}

function getActiveMnemonicEntry(ks: KeystoreV2): MnemonicEntry {
	const entry = ks.mnemonics[ks.activeIndex];
	if (!entry) throw new Error("No active mnemonic found in keystore.");
	return entry;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get genesis accounts from keystore (addresses + keys when not encrypted).
 * Works offline — does not require the node to be running.
 */
export function getAccounts(): AccountInfo[] {
	const ks = loadKeystore();
	const entry = getActiveMnemonicEntry(ks);

	if (entry.derivedKeys.type === "plaintext") {
		const accounts = entry.derivedKeys.genesisAccounts as DerivedAccount[];
		return accounts.map((a) => ({
			index: a.index,
			coreAddress: a.core,
			evmAddress: a.evm,
			corePrivateKey: a.privateKey,
			evmPrivateKey: a.evmPrivateKey,
		}));
	}

	// Encrypted — addresses not pre-stored in readable form.
	// The conflict-devkit API (/api/accounts) will return addresses when running.
	throw new Error(
		'Keystore is encrypted. Unlock it via "Conflux: Unlock Keystore" and retry.',
	);
}

/**
 * Get a single account by index. Throws if encrypted or index out of range.
 */
export function getAccount(index: number): AccountInfo {
	const accounts = getAccounts();
	const account = accounts.find((a) => a.index === index) ?? accounts[index];
	if (!account) {
		throw new Error(
			`Account index ${index} not found. ` +
				`Keystore has ${accounts.length} genesis accounts (0–${accounts.length - 1}).`,
		);
	}
	return account;
}

/**
 * Resolve a private key from accountIndex. Used internally by write MCP tools.
 * Prefer this over asking the agent for a raw private key.
 */
export function resolvePrivateKey(
	accountIndex: number,
	chain: "espace" | "core",
): string {
	const account = getAccount(accountIndex);
	if (chain === "espace") {
		if (!account.evmPrivateKey)
			throw new Error(
				"Keystore encrypted — cannot resolve eSpace private key.",
			);
		return account.evmPrivateKey;
	}
	if (!account.corePrivateKey)
		throw new Error("Keystore encrypted — cannot resolve Core private key.");
	return account.corePrivateKey;
}

/**
 * Get the faucet/mining account from keystore (m/44'/503'/1'/0/0).
 * This account receives mining rewards and has a separate derivation path.
 */
export function getFaucetAccount(): AccountInfo {
	const ks = loadKeystore();
	const entry = getActiveMnemonicEntry(ks);
	if (entry.derivedKeys.type !== "plaintext") {
		throw new Error("Keystore is encrypted. Unlock it first.");
	}
	const fa = entry.derivedKeys.faucetAccount as DerivedAccount;
	return {
		index: -1, // special account, not a genesis index
		coreAddress: fa.core,
		evmAddress: fa.evm,
		corePrivateKey: fa.privateKey,
		evmPrivateKey: fa.evmPrivateKey,
	};
}

/**
 * Get the plaintext mnemonic (throws if keystore is encrypted).
 */
export function getMnemonic(): string {
	const ks = loadKeystore();
	const entry = getActiveMnemonicEntry(ks);
	if (entry.type !== "plaintext") {
		throw new Error("Keystore is encrypted. Unlock it first.");
	}
	return entry.mnemonic;
}

/**
 * Get node configuration from the active keystore entry.
 */
export function getNodeConfig(): NodeConfigInfo {
	const ks = loadKeystore();
	const entry = getActiveMnemonicEntry(ks);
	const { chainId, evmChainId } = entry.nodeConfig;
	return {
		chainId,
		evmChainId,
		accountsCount: entry.nodeConfig.accountsCount,
		coreAddressPrefix: CORE_ADDRESS_PREFIXES[chainId] ?? `net${chainId}`,
		networkName: CORE_NETWORK_NAMES[chainId] ?? "custom",
	};
}

/**
 * Check if the keystore exists and is readable (for diagnostics).
 */
export function keystoreStatus(): {
	exists: boolean;
	path: string;
	encrypted: boolean;
	locked?: boolean;
	accountsCount?: number;
	label?: string;
	networkName?: string;
} {
	if (!existsSync(KEYSTORE_PATH)) {
		return { exists: false, path: KEYSTORE_PATH, encrypted: false };
	}
	try {
		const ks = loadKeystore();
		const entry = getActiveMnemonicEntry(ks);
		return {
			exists: true,
			path: KEYSTORE_PATH,
			encrypted: ks.encryptionEnabled,
			locked: ks.encryptionEnabled, // simplified — true if encrypted
			accountsCount: entry.nodeConfig.accountsCount,
			label: entry.label,
			networkName: CORE_NETWORK_NAMES[entry.nodeConfig.chainId] ?? "custom",
		};
	} catch {
		return { exists: true, path: KEYSTORE_PATH, encrypted: false };
	}
}
