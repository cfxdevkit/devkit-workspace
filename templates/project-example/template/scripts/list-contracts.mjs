#!/usr/bin/env node

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exampleCounterArtifact } from "../contracts/generated/example-counter.js";
import { parseOperationFlags, runOperation } from "./lib/operations.mjs";

const flags = parseOperationFlags();

async function readTrackedAddress() {
	const generatedAddressesPath = resolve(
		process.cwd(),
		"dapp",
		"src",
		"generated",
		"contracts-addresses.js",
	);
	if (!existsSync(generatedAddressesPath)) {
		return null;
	}

	const module = await import(pathToFileURL(generatedAddressesPath).href);
	return (
		module.CONTRACT_ADDRESSES_BY_CHAIN_ID?.[exampleCounterArtifact.chainId]?.[
			exampleCounterArtifact.contractName
		] ?? null
	);
}

await runOperation("list-contracts", flags, async ({ step }) => {
	step("load-contract-artifact", {
		status: "completed",
		contractName: exampleCounterArtifact.contractName,
		chainId: exampleCounterArtifact.chainId,
	});

	const trackedAddress = await readTrackedAddress();
	const result = {
		contracts: [
			{
				contractName: exampleCounterArtifact.contractName,
				chainId: exampleCounterArtifact.chainId,
				trackedAddress,
				abiEntries: Array.isArray(exampleCounterArtifact.abi)
					? exampleCounterArtifact.abi.length
					: 0,
			},
		],
		message: `Listed 1 contract for chain ${exampleCounterArtifact.chainId}.`,
	};

	step("read-tracked-addresses", { status: "completed", trackedAddress });
	return result;
});
