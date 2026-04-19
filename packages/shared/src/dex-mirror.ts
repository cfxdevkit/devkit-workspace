/**
 * dex-mirror.ts
 *
 * TokenMirror — pure in-memory address translation table manager.
 *
 * Maps real-world token addresses (mainnet/testnet) to local mirror token
 * addresses deployed on the local devnet.
 *
 * State is no longer persisted to disk here. Callers are responsible for
 * persisting the translation table via the DEX service API:
 *   POST http://DEX_URL/api/dex/translation-table
 *
 * Deployment and minting logic lives in packages/mcp-server/src/dex.ts.
 */

import type { TokenFeedData } from "./dex-feed.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AddressTranslation {
	realAddress: string; // on mainnet/target chain (lowercase)
	localAddress: string; // deployed on local node (lowercase)
	symbol: string;
	decimals: number;
	iconCached: boolean;
	mirroredAt: number; // Unix ms of deployment
}

export interface TranslationTable {
	chainId: number;
	localWETH: string; // local WETH9 / WCFX address
	updatedAt: number; // Unix ms
	entries: AddressTranslation[];
}

export interface MirrorDeployConfig {
	chainId: number;
	localWETH: string;
	/** Optionally seed with an existing table (e.g. loaded from DEX service API on restart). */
	initialTable?: TranslationTable;
}

// ── TokenMirror class ─────────────────────────────────────────────────────────

export class TokenMirror {
	private table: TranslationTable;

	constructor(config: MirrorDeployConfig) {
		this.table = config.initialTable ?? {
			chainId: config.chainId,
			localWETH: config.localWETH,
			updatedAt: Date.now(),
			entries: [],
		};
	}

	/**
	 * Record a newly deployed mirror token in the in-memory translation table.
	 * Returns the updated full table so the caller can POST it to the DEX service.
	 */
	recordMirror(
		token: Pick<
			TokenFeedData,
			"realAddress" | "symbol" | "decimals" | "iconCached"
		>,
		localAddress: string,
	): AddressTranslation {
		const entry: AddressTranslation = {
			realAddress: token.realAddress.toLowerCase(),
			localAddress: localAddress.toLowerCase(),
			symbol: token.symbol,
			decimals: token.decimals,
			iconCached: token.iconCached ?? false,
			mirroredAt: Date.now(),
		};
		const idx = this.table.entries.findIndex(
			(e) => e.realAddress === entry.realAddress,
		);
		if (idx >= 0) {
			this.table.entries[idx] = entry;
		} else {
			this.table.entries.push(entry);
		}
		this.table.updatedAt = Date.now();
		return entry;
	}

	// ── Lookups ──────────────────────────────────────────────────────────────

	getLocalAddress(realAddress: string): string | undefined {
		return this.table.entries.find(
			(e) => e.realAddress === realAddress.toLowerCase(),
		)?.localAddress;
	}

	getRealAddress(localAddress: string): string | undefined {
		return this.table.entries.find(
			(e) => e.localAddress === localAddress.toLowerCase(),
		)?.realAddress;
	}

	isMirrorToken(address: string): boolean {
		return this.table.entries.some(
			(e) => e.localAddress === address.toLowerCase(),
		);
	}

	getTranslationTable(): TranslationTable {
		return this.table;
	}

	getEntry(realAddress: string): AddressTranslation | undefined {
		return this.table.entries.find(
			(e) => e.realAddress === realAddress.toLowerCase(),
		);
	}
}

// ── Standalone factory ─────────────────────────────────────────────────────────

export function createTokenMirror(config: MirrorDeployConfig): TokenMirror {
	return new TokenMirror(config);
}
