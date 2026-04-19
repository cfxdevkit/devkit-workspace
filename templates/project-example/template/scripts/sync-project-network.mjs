#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseOperationFlags, runOperation } from "./lib/operations.mjs";

const flags = parseOperationFlags();

const DEFAULT_CHAIN_ID_BY_NETWORK = {
	local: 2030,
	testnet: 71,
	mainnet: 1030,
};

function resolveProjectNetwork() {
	const network = process.env.DEVKIT_NETWORK ?? "local";
	const explicitChainId = Number(
		process.env.DEPLOY_CHAIN_ID ??
			process.env.PROJECT_CHAIN_ID ??
			process.env.VITE_CHAIN_ID ??
			"",
	);

	if (Number.isFinite(explicitChainId) && explicitChainId > 0) {
		return {
			network,
			chainId: explicitChainId,
			source: "env-chain-id",
		};
	}

	return {
		network,
		chainId: DEFAULT_CHAIN_ID_BY_NETWORK[network] ?? 2030,
		source: "network-profile",
	};
}

await runOperation("sync-project-network", flags, async ({ step }) => {
	const outputDir = resolve(process.cwd(), "dapp", "src", "generated");
	const outputPath = resolve(outputDir, "project-network.js");
	const outputTsPath = resolve(outputDir, "project-network.ts");
	const projectNetwork = resolveProjectNetwork();

	step("resolve-network", {
		status: "completed",
		network: projectNetwork.network,
		chainId: projectNetwork.chainId,
		source: projectNetwork.source,
	});

	mkdirSync(outputDir, { recursive: true });

	const jsContent = `export const PROJECT_NETWORK = ${JSON.stringify(projectNetwork, null, 2)};\nexport const PROJECT_DEFAULT_CHAIN_ID = ${projectNetwork.chainId};\nexport const PROJECT_NETWORK_SOURCE = ${JSON.stringify(projectNetwork.source)};\n`;
	writeFileSync(outputPath, jsContent, "utf8");

	const tsContent = `export const PROJECT_NETWORK = ${JSON.stringify(projectNetwork, null, 2)} as const;\nexport const PROJECT_DEFAULT_CHAIN_ID: number = ${projectNetwork.chainId};\nexport const PROJECT_NETWORK_SOURCE: string = ${JSON.stringify(projectNetwork.source)};\n`;
	writeFileSync(outputTsPath, tsContent, "utf8");

	step("write-generated-network", {
		status: "completed",
		outputPath: "dapp/src/generated/project-network.{js,ts}",
	});
	return {
		network: projectNetwork.network,
		chainId: projectNetwork.chainId,
		source: projectNetwork.source,
		outputPath: "dapp/src/generated/project-network.{js,ts}",
		message: `Wrote dapp/src/generated/project-network.js and .ts for ${projectNetwork.network} (${projectNetwork.chainId})`,
	};
});
