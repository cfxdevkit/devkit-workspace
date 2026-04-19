/**
 * keystore-reader.ts
 *
 * Reads the conflux-devkit keystore file directly — no server required.
 * Returns eSpace (0x…) addresses and the locally-stored Core address
 * (net2029:… format) for all genesis accounts.
 *
 * This lets the Accounts tree view show addresses even when the devkit
 * server is offline.  Only works for plaintext keystores; encrypted
 * keystores require the running server to decrypt.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface OfflineAccount {
	index: number;
	/** Core Space address stored in the keystore — always net2029:… format (local devkit) */
	coreAddress: string;
	/** eSpace (EVM-compatible) 0x address — same across all Conflux networks */
	evmAddress: string;
}

interface DerivedAccountRaw {
	index: number;
	core: string;
	evm: string;
}

interface KeystoreV2 {
	version: number;
	setupCompleted: boolean;
	encryptionEnabled: boolean;
	mnemonics: Array<{
		derivedKeys: {
			type: "plaintext" | "encrypted";
			genesisAccounts: DerivedAccountRaw[] | string;
		};
	}>;
	activeIndex: number;
}

/**
 * Read genesis accounts from the devkit keystore file without requiring the server.
 * Returns null if the file doesn't exist, setup is incomplete, or the keystore
 * is encrypted (encryption requires the server to hold the decryption key).
 */
export function readKeystoreAccounts(): OfflineAccount[] | null {
	const keystorePath =
		process.env.DEVKIT_KEYSTORE_PATH ??
		path.join(os.homedir(), ".devkit.keystore.json");

	if (!fs.existsSync(keystorePath)) return null;

	try {
		const ks = JSON.parse(fs.readFileSync(keystorePath, "utf-8")) as KeystoreV2;
		if (ks.version !== 2 || !ks.setupCompleted) return null;

		const entry = ks.mnemonics[ks.activeIndex];
		if (!entry || entry.derivedKeys.type === "encrypted") return null;

		const accounts = entry.derivedKeys.genesisAccounts as DerivedAccountRaw[];
		return accounts.map((a) => ({
			index: a.index,
			coreAddress: a.core, // net2029:… format
			evmAddress: a.evm, // 0x… format
		}));
	} catch {
		return null;
	}
}
