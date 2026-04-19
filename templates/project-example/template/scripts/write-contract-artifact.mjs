#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { exampleCounterArtifact } from "../contracts/generated/example-counter.js";
import { readTracking, toAddressMap } from "./deployment-registry.mjs";
import { parseOperationFlags, runOperation } from "./lib/operations.mjs";

const flags = parseOperationFlags();

/**
 * Merge addresses from the CONTRACT_ADDRESSES env var (JSON) into the map
 * produced from deployments/contracts.json.
 *
 * This allows CI / Vercel builds to inject addresses when the tracking file
 * is missing or incomplete.
 *
 * Expected shape:
 *   CONTRACT_ADDRESSES='{"71":{"ExampleCounter":"0x1234..."}}'
 *
 * Individual overrides also work (takes precedence):
 *   CONTRACT_ADDRESS_ExampleCounter_71=0x1234...
 */
function mergeEnvAddresses(addressMap) {
	// 1. Bulk JSON override
	const raw = process.env.CONTRACT_ADDRESSES?.trim();
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			for (const [cid, contracts] of Object.entries(parsed)) {
				const chainId = Number(cid);
				if (!Number.isFinite(chainId) || chainId <= 0) continue;
				if (!addressMap[chainId]) addressMap[chainId] = {};
				for (const [name, addr] of Object.entries(contracts)) {
					if (typeof addr === "string" && addr.startsWith("0x")) {
						addressMap[chainId][name] = addr;
					}
				}
			}
		} catch {
			console.warn(
				"WARNING: CONTRACT_ADDRESSES env var is not valid JSON — ignored.",
			);
		}
	}

	// 2. Per-contract overrides: CONTRACT_ADDRESS_<Name>_<chainId>=0x...
	const prefix = "CONTRACT_ADDRESS_";
	for (const [key, val] of Object.entries(process.env)) {
		if (!key.startsWith(prefix) || !val) continue;
		const rest = key.slice(prefix.length);
		const lastUnderscore = rest.lastIndexOf("_");
		if (lastUnderscore < 1) continue;
		const name = rest.slice(0, lastUnderscore);
		const chainId = Number(rest.slice(lastUnderscore + 1));
		if (!Number.isFinite(chainId) || chainId <= 0) continue;
		if (!val.startsWith("0x")) continue;
		if (!addressMap[chainId]) addressMap[chainId] = {};
		addressMap[chainId][name] = val;
	}

	return addressMap;
}

await runOperation("write-contract-artifact", flags, async ({ step }) => {
	const outputDir = resolve(process.cwd(), "dapp", "src", "generated");
	const outputPath = resolve(outputDir, "contracts-addresses.js");
	const outputTsPath = resolve(outputDir, "contracts-addresses.ts");
	const chainId = Number(exampleCounterArtifact.chainId) || 2030;

	// Read deployed addresses from the deployment tracking file so that
	// successive `pnpm codegen` calls do NOT wipe addresses written by `pnpm deploy`.
	// Then merge any env-var overrides (for CI / Vercel builds).
	const trackingState = readTracking();
	const addressMap = mergeEnvAddresses(toAddressMap(trackingState));

	const trackedAddress =
		addressMap[chainId]?.[exampleCounterArtifact.contractName] ?? null;
	const catalog = [
		{
			contractName: exampleCounterArtifact.contractName,
			chainId,
			trackedAddress,
			abiEntries: Array.isArray(exampleCounterArtifact.abi)
				? exampleCounterArtifact.abi.length
				: 0,
		},
	];

	step("load-contract-artifact", {
		status: "completed",
		contractName: exampleCounterArtifact.contractName,
		chainId,
	});

	mkdirSync(outputDir, { recursive: true });
	writeFileSync(
		outputPath,
		`export const CONTRACT_ADDRESSES_BY_CHAIN_ID = ${JSON.stringify(addressMap, null, 2)};\n\nexport function getContractAddress(chainId, contractName) {\n  return CONTRACT_ADDRESSES_BY_CHAIN_ID[chainId]?.[contractName] ?? null;\n}\n\nexport const CONTRACT_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`,
		"utf8",
	);
	writeFileSync(
		outputTsPath,
		`export type ContractAddressMap = Record<number, Record<string, \`0x\${string}\`>>;\n\nexport const CONTRACT_ADDRESSES_BY_CHAIN_ID: ContractAddressMap = ${JSON.stringify(addressMap, null, 2)} as ContractAddressMap;\n\nexport function getContractAddress(chainId: number, contractName: string): \`0x\${string}\` | undefined {\n  return CONTRACT_ADDRESSES_BY_CHAIN_ID[chainId]?.[contractName];\n}\n\nexport const CONTRACT_CATALOG = ${JSON.stringify(catalog, null, 2)} as const;\n`,
		"utf8",
	);

	step("write-contract-catalog", {
		status: "completed",
		outputPath: "dapp/src/generated/contracts-addresses.js",
	});
	return {
		contractName: exampleCounterArtifact.contractName,
		chainId,
		trackedAddress,
		outputPath: "dapp/src/generated/contracts-addresses.js",
		message:
			"Wrote dapp/src/generated/contracts-addresses.js and contracts-addresses.ts",
	};
});
