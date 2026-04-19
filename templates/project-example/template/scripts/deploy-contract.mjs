#!/usr/bin/env node
/**
 * deploy-contract.mjs — Network-aware deploy entry point.
 *
 * Reads DEVKIT_NETWORK (injected by the VS Code extension when "Deploy contracts"
 * is run from the Project menu):
 *   - 'local' (default) → deploy via DevKit backend API (local Conflux node)
 *   - 'testnet' or 'mainnet' → deploy via DevKit backend API (public RPC,
 *       uses DevKit keystore; DEPLOY_PRIVATE_KEY is an optional override only)
 *
 * Env vars injected by the extension:
 *   DEVKIT_NETWORK      local | testnet | mainnet
 *   DEPLOY_CHAIN_ID     EVM chain ID (2030 / 71 / 1030)
 *   DEPLOY_RPC_URL      EVM RPC endpoint
 *   DEPLOY_NETWORK      same as DEVKIT_NETWORK (alias)
 *
 * Additional env vars for public deploy:
 *   DEPLOY_ACCOUNT_INDEX  keystore account index to sign with (default: 0)
 *   DEPLOY_PRIVATE_KEY    hex private key — overrides keystore if provided
 *   DEVKIT_URL            DevKit backend URL (default: http://127.0.0.1:7748)
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	readTracking,
	updateFromDeployedContracts,
	upsertDeployment,
	writeFrontendArtifactFromTracking,
	writeTracking,
} from "./deployment-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEVKIT_URL = process.env.DEVKIT_URL ?? "http://127.0.0.1:7748";
const DEVKIT_NETWORK = (
	process.env.DEVKIT_NETWORK ??
	process.env.DEPLOY_NETWORK ??
	"local"
)
	.trim()
	.toLowerCase();
const CONTRACT_NAME = process.env.DEPLOY_CONTRACT_NAME ?? "ExampleCounter";
const SOURCE_PATH = resolve(__dirname, "..", "contracts", "Counter.sol");

const EXPLORER_BY_CHAIN_ID = {
	71: "https://evmtestnet.confluxscan.org",
	1030: "https://evm.confluxscan.org",
};

const DEFAULT_CHAIN_ID_BY_NETWORK = {
	local: 2030,
	testnet: 71,
	mainnet: 1030,
};

function writeProjectNetworkArtifacts(network, chainId, source) {
	const outputDir = resolve(__dirname, "..", "dapp", "src", "generated");
	const outputPath = resolve(outputDir, "project-network.js");
	const outputTsPath = resolve(outputDir, "project-network.ts");
	const projectNetwork = {
		network,
		chainId,
		source,
	};

	mkdirSync(outputDir, { recursive: true });
	writeFileSync(
		outputPath,
		`export const PROJECT_NETWORK = ${JSON.stringify(projectNetwork, null, 2)};\nexport const PROJECT_DEFAULT_CHAIN_ID = ${projectNetwork.chainId};\nexport const PROJECT_NETWORK_SOURCE = ${JSON.stringify(projectNetwork.source)};\n`,
		"utf8",
	);
	writeFileSync(
		outputTsPath,
		`export const PROJECT_NETWORK = ${JSON.stringify(projectNetwork, null, 2)} as const;\nexport const PROJECT_DEFAULT_CHAIN_ID: number = ${projectNetwork.chainId};\nexport const PROJECT_NETWORK_SOURCE: string = ${JSON.stringify(projectNetwork.source)};\n`,
		"utf8",
	);
}

async function fetchDevkit(path, init, timeout = 30_000) {
	const response = await fetch(`${DEVKIT_URL}${path}`, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
		signal: AbortSignal.timeout(timeout),
	});
	const text = await response.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = null;
	}
	if (!response.ok) {
		throw new Error(json?.error ?? text ?? `HTTP ${response.status}`);
	}
	return json;
}

function normalizeDeployedContract(payload) {
	if (!payload || typeof payload !== "object") return null;
	if (typeof payload.address === "string") return payload;
	if (payload.data?.address) return payload.data;
	if (payload.contract?.address) return payload.contract;
	return null;
}

function unwrapDeployedContracts(payload) {
	if (Array.isArray(payload)) return payload;
	if (!payload || typeof payload !== "object") return [];
	if (Array.isArray(payload.contracts)) return payload.contracts;
	if (Array.isArray(payload.data)) return payload.data;
	if (Array.isArray(payload.data?.contracts)) return payload.data.contracts;
	return [];
}

async function deployLocal() {
	console.log(`Deploying ${CONTRACT_NAME} via DevKit local node...`);

	let contracts = unwrapDeployedContracts(
		await fetchDevkit("/api/contracts/deployed").catch(() => []),
	);
	const existing = contracts.find((c) => c.name === CONTRACT_NAME);

	if (!existing) {
		const source = readFileSync(SOURCE_PATH, "utf8");
		const compiled = await fetchDevkit("/api/contracts/compile", {
			method: "POST",
			body: JSON.stringify({ source, contractName: CONTRACT_NAME }),
		});

		const deployPayload = await fetchDevkit("/api/contracts/deploy", {
			method: "POST",
			body: JSON.stringify({
				contractName: CONTRACT_NAME,
				abi: compiled.abi,
				bytecode: compiled.bytecode,
				args: [],
				chain: "evm",
				accountIndex: 0,
			}),
		});

		const deployed = normalizeDeployedContract(deployPayload);
		if (!deployed)
			throw new Error(
				"DevKit deploy response did not include a contract address",
			);

		console.log(
			`Deployed ${deployed.name ?? CONTRACT_NAME} at ${deployed.address}`,
		);
		contracts = unwrapDeployedContracts(
			await fetchDevkit("/api/contracts/deployed").catch(() => contracts),
		);
	} else {
		console.log(`Already deployed: ${existing.name} at ${existing.address}`);
	}

	const state = readTracking();
	updateFromDeployedContracts(state, contracts, "devkit-local");
	writeTracking(state);
	writeFrontendArtifactFromTracking(state);
	writeProjectNetworkArtifacts(
		DEVKIT_NETWORK,
		DEFAULT_CHAIN_ID_BY_NETWORK[DEVKIT_NETWORK] ?? 2030,
		"deploy-local",
	);
	console.log("Updated deployment tracking and frontend contract artifact.");
}

async function deployPublic() {
	const chainId = Number(process.env.DEPLOY_CHAIN_ID);
	const rpcUrl = process.env.DEPLOY_RPC_URL?.trim();
	const accountIndex = Number(process.env.DEPLOY_ACCOUNT_INDEX ?? "0");
	const privateKey = process.env.DEPLOY_PRIVATE_KEY?.trim() || undefined;
	const networkLabel = DEVKIT_NETWORK;
	const coreRpcByNetwork = {
		testnet: "https://test.confluxrpc.com",
		mainnet: "https://main.confluxrpc.com",
	};

	if (!Number.isFinite(chainId) || chainId <= 0) {
		throw new Error(
			`DEPLOY_CHAIN_ID is missing or invalid: "${process.env.DEPLOY_CHAIN_ID}"`,
		);
	}
	if (!rpcUrl)
		throw new Error("DEPLOY_RPC_URL is required for testnet/mainnet deploys");

	const coreRpcUrl = coreRpcByNetwork[networkLabel];
	if (!coreRpcUrl) {
		throw new Error(
			`Unsupported DEVKIT_NETWORK for public deploy: ${networkLabel}`,
		);
	}

	console.log(
		`Syncing DevKit backend to ${networkLabel} (chainId ${chainId})...`,
	);

	await fetchDevkit("/api/network/current", {
		method: "PUT",
		body: JSON.stringify({
			mode: "public",
			public: {
				evmRpcUrl: rpcUrl,
				coreRpcUrl,
				chainId: networkLabel === "testnet" ? 1 : 1029,
				evmChainId: chainId,
			},
		}),
	});

	console.log(`Compiling ${CONTRACT_NAME}...`);
	const source = readFileSync(SOURCE_PATH, "utf8");
	const compiled = await fetchDevkit("/api/contracts/compile", {
		method: "POST",
		body: JSON.stringify({ source, contractName: CONTRACT_NAME }),
	});

	console.log(
		`Deploying ${CONTRACT_NAME} to ${networkLabel} (chainId ${chainId}) ` +
			`via DevKit backend (accountIndex ${accountIndex}${privateKey ? ", key override" : ""})...`,
	);
	const deployPayload = await fetchDevkit(
		"/api/contracts/deploy",
		{
			method: "POST",
			body: JSON.stringify({
				contractName: CONTRACT_NAME,
				abi: compiled.abi,
				bytecode: compiled.bytecode,
				args: [],
				chain: "evm",
				accountIndex,
				...(privateKey ? { privateKey } : {}),
			}),
		},
		120_000,
	);

	const deployed = normalizeDeployedContract(deployPayload);
	if (!deployed)
		throw new Error(
			"DevKit deploy response did not include a contract address",
		);

	const contractAddress = deployed.address;
	const txHash = deployed.txHash ?? deployed.transactionHash ?? "";
	const deployer = deployed.deployer ?? "";

	const state = readTracking();
	upsertDeployment(state, {
		network: networkLabel,
		chainId,
		contractName: CONTRACT_NAME,
		address: contractAddress,
		txHash,
		deployer,
		source: "devkit-public",
	});

	writeTracking(state);
	writeFrontendArtifactFromTracking(state);
	writeProjectNetworkArtifacts(networkLabel, chainId, "deploy-public");

	console.log(`Deployed ${CONTRACT_NAME} at ${contractAddress}`);
	if (txHash) console.log(`Transaction: ${txHash}`);
	const explorer =
		process.env.DEPLOY_EXPLORER_BASE?.trim() || EXPLORER_BY_CHAIN_ID[chainId];
	if (explorer) console.log(`Explorer: ${explorer}/address/${contractAddress}`);
	console.log("Updated deployment tracking and frontend contract artifact.");
}

async function main() {
	if (DEVKIT_NETWORK === "local") {
		await deployLocal();
	} else if (DEVKIT_NETWORK === "testnet" || DEVKIT_NETWORK === "mainnet") {
		await deployPublic();
	} else {
		throw new Error(
			`Unknown DEVKIT_NETWORK value: "${DEVKIT_NETWORK}". Expected local | testnet | mainnet`,
		);
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
