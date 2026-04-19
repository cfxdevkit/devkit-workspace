#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const TRACKING_PATH = resolve(
	__dirname,
	"..",
	"deployments",
	"contracts.json",
);
export const ARTIFACT_PATH = resolve(
	__dirname,
	"..",
	"dapp",
	"src",
	"generated",
	"contracts-addresses.js",
);
export const ARTIFACT_TS_PATH = resolve(
	__dirname,
	"..",
	"dapp",
	"src",
	"generated",
	"contracts-addresses.ts",
);

// Both eSpace (2030) and Core (2029) local chain IDs map to the same 'local' bucket so
// the deploy tracking stays consistent with backend normalization.
const CHAIN_ID_LABELS = {
	2029: "local",
	2030: "local",
	71: "testnet",
	1030: "mainnet",
};

function emptyState() {
	return {
		version: 1,
		updatedAt: new Date(0).toISOString(),
		networks: {},
	};
}

export function readTracking(path = TRACKING_PATH) {
	if (!existsSync(path)) return emptyState();

	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		if (!parsed || typeof parsed !== "object") return emptyState();
		if (!parsed.networks || typeof parsed.networks !== "object")
			parsed.networks = {};
		if (!parsed.version) parsed.version = 1;
		return parsed;
	} catch {
		return emptyState();
	}
}

function ensureNetwork(state, network, chainId) {
	if (!state.networks[network]) {
		state.networks[network] = {
			chainId,
			contracts: {},
		};
	}

	state.networks[network].chainId = chainId;
	if (
		!state.networks[network].contracts ||
		typeof state.networks[network].contracts !== "object"
	) {
		state.networks[network].contracts = {};
	}

	return state.networks[network];
}

export function upsertDeployment(state, entry) {
	const network = (entry.network ?? `chain-${entry.chainId}`).trim();
	const chainId = Number(entry.chainId);
	if (!Number.isFinite(chainId) || chainId <= 0) {
		throw new Error(
			`Invalid chainId for ${entry.contractName}: ${entry.chainId}`,
		);
	}

	const bucket = ensureNetwork(state, network, chainId);
	bucket.contracts[entry.contractName] = {
		address: entry.address,
		txHash: entry.txHash ?? null,
		deployedAt: entry.deployedAt ?? new Date().toISOString(),
		deployer: entry.deployer ?? null,
		source: entry.source ?? "unknown",
	};
}

export function normalizeChainId(contract) {
	if (
		typeof contract?.chainId === "number" &&
		Number.isFinite(contract.chainId)
	) {
		return contract.chainId;
	}
	if (contract?.chain === "core") return 2029;
	if (contract?.chain === "evm") return 2030;
	return 2030;
}

export function networkLabelForChainId(chainId) {
	return CHAIN_ID_LABELS[chainId] ?? `chain-${chainId}`;
}

export function updateFromDeployedContracts(
	state,
	contracts,
	source = "devkit",
) {
	for (const contract of contracts) {
		if (
			!contract ||
			typeof contract.address !== "string" ||
			typeof contract.name !== "string"
		)
			continue;

		const chainId = normalizeChainId(contract);
		upsertDeployment(state, {
			network: networkLabelForChainId(chainId),
			chainId,
			contractName: contract.name,
			address: contract.address,
			txHash: contract.txHash,
			deployer: contract.deployerAddress,
			deployedAt: contract.deployedAt,
			source,
		});
	}
}

export function toAddressMap(state) {
	const byChain = {};
	for (const networkState of Object.values(state.networks ?? {})) {
		const chainId = Number(networkState?.chainId);
		if (!Number.isFinite(chainId) || chainId <= 0) continue;

		if (!byChain[chainId]) byChain[chainId] = {};
		const contracts = networkState?.contracts ?? {};

		for (const [name, info] of Object.entries(contracts)) {
			if (!info || typeof info.address !== "string") continue;
			byChain[chainId][name] = info.address;
		}
	}
	return byChain;
}

function buildArtifact(map) {
	return `export const CONTRACT_ADDRESSES_BY_CHAIN_ID = ${JSON.stringify(map, null, 2)};\n\nexport function getContractAddress(chainId, contractName) {\n  return CONTRACT_ADDRESSES_BY_CHAIN_ID[chainId]?.[contractName] ?? null;\n}\n`;
}

function buildTypedArtifact(map) {
	return `export type ContractAddressMap = Record<number, Record<string, \`0x\${string}\`>>;\n\nexport const CONTRACT_ADDRESSES_BY_CHAIN_ID: ContractAddressMap = ${JSON.stringify(map, null, 2)} as ContractAddressMap;\n\nexport function getContractAddress(chainId: number, contractName: string): \`0x\${string}\` | undefined {\n  return CONTRACT_ADDRESSES_BY_CHAIN_ID[chainId]?.[contractName];\n}\n`;
}

export function writeTracking(state, path = TRACKING_PATH) {
	state.updatedAt = new Date().toISOString();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function writeFrontendArtifactFromTracking(
	state,
	artifactPath = ARTIFACT_PATH,
) {
	const map = toAddressMap(state);
	mkdirSync(dirname(artifactPath), { recursive: true });
	writeFileSync(artifactPath, buildArtifact(map), "utf8");
	writeFileSync(ARTIFACT_TS_PATH, buildTypedArtifact(map), "utf8");
}
