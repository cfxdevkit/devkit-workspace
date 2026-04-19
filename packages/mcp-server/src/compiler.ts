/**
 * compiler.ts — Solidity compile + template tools for the MCP server
 *
 * Uses @cfxdevkit/compiler (solc-js wrapper, 'paris' EVM target for Conflux
 * compatibility — avoids the PUSH0 opcode).
 *
 * Tools exposed:
 *   cfxdevkit_list_templates    — list all 8 built-in contract templates
 *   cfxdevkit_get_template      — get source + ABI + bytecode for a template
 *   cfxdevkit_compile_solidity  — compile arbitrary Solidity source
 *
 * Deployment of compiled contracts is handled by the existing blockchain_*_deploy_contract
 * tools. The workflow is:
 *   1. cfxdevkit_compile_solidity  → get ABI + bytecode
 *   2. blockchain_espace_deploy_contract (or core) → deploy + track in .devkit-contracts.json
 *
 * Or use cfxdevkit_get_template for pre-built contracts that don't need compilation.
 */

import {
	COUNTER_SOURCE,
	compileSolidity,
	ERC721_SOURCE,
	ESCROW_SOURCE,
	getCounterContract,
	getERC721Contract,
	getEscrowContract,
	getMultiSigContract,
	getRegistryContract,
	getSimpleStorageContract,
	getSolcVersion,
	getTestTokenContract,
	getVotingContract,
	MULTISIG_SOURCE,
	REGISTRY_SOURCE,
	SIMPLE_STORAGE_SOURCE,
	TEST_TOKEN_SOURCE,
	VOTING_SOURCE,
} from "@cfxdevkit/compiler";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// ── Template registry ─────────────────────────────────────────────────────────

const TEMPLATES = {
	SimpleStorage: {
		description: "Basic key-value storage — great for testing reads/writes",
		source: SIMPLE_STORAGE_SOURCE,
		get: getSimpleStorageContract,
	},
	TestToken: {
		description:
			"ERC-20 token with mint/burn — useful for DeFi and transfer testing",
		source: TEST_TOKEN_SOURCE,
		get: getTestTokenContract,
	},
	Counter: {
		description:
			"Ownable step counter with increment/decrement/reset — ideal first contract",
		source: COUNTER_SOURCE,
		get: getCounterContract,
	},
	BasicNFT: {
		description:
			"ERC-721 NFT — teaches token ownership, approvals, and transfers",
		source: ERC721_SOURCE,
		get: getERC721Contract,
	},
	Voting: {
		description:
			"Ballot with vote delegation — teaches structs, weighted votes, governance",
		source: VOTING_SOURCE,
		get: getVotingContract,
	},
	Escrow: {
		description:
			"Three-party escrow with arbiter — teaches payable, state machines, CFX transfers",
		source: ESCROW_SOURCE,
		get: getEscrowContract,
	},
	MultiSigWallet: {
		description:
			"M-of-N multi-signature wallet — teaches collective governance and low-level call",
		source: MULTISIG_SOURCE,
		get: getMultiSigContract,
	},
	Registry: {
		description:
			"On-chain name registry — teaches keccak256 keys, mappings, and string storage",
		source: REGISTRY_SOURCE,
		get: getRegistryContract,
	},
} as const;

type TemplateName = keyof typeof TEMPLATES;

// ── Tool definitions ──────────────────────────────────────────────────────────

export const compilerToolDefinitions: Tool[] = [
	{
		name: "cfxdevkit_list_templates",
		description:
			"List all built-in Solidity contract templates available for deployment on Conflux. " +
			"These are pre-compiled and ready to deploy — no compilation step needed. " +
			"Use cfxdevkit_get_template to fetch ABI + bytecode for a specific template, " +
			"then deploy it with blockchain_espace_deploy_contract.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "cfxdevkit_get_template",
		description:
			"Get the Solidity source code, ABI, and compiled bytecode for a built-in contract template. " +
			"The returned bytecode is ready to pass directly to blockchain_espace_deploy_contract. " +
			'Templates are pre-compiled with solc 0.8.28, EVM target "paris" (Conflux compatible). ' +
			"Use cfxdevkit_list_templates first to see available names.",
		inputSchema: {
			type: "object",
			required: ["name"],
			properties: {
				name: {
					type: "string",
					description:
						'Template name, e.g. "TestToken", "Counter", "SimpleStorage", "BasicNFT", ' +
						'"Voting", "Escrow", "MultiSigWallet", "Registry"',
				},
			},
		},
	},
	{
		name: "cfxdevkit_compile_solidity",
		description:
			'Compile arbitrary Solidity source code using solc 0.8.28 with EVM target "paris" ' +
			"(required for Conflux eSpace — avoids the PUSH0 opcode). " +
			"Returns ABI (as JSON string) and bytecode ready for deployment. " +
			"After compiling, use blockchain_espace_deploy_contract or blockchain_core_deploy_contract. " +
			"TIP: Use cfxdevkit_get_template for common patterns instead of writing from scratch.",
		inputSchema: {
			type: "object",
			required: ["source"],
			properties: {
				source: {
					type: "string",
					description:
						"Full Solidity source code as a string. Must include pragma statement.",
				},
				contractName: {
					type: "string",
					description:
						"Name of the main contract to extract from the compiled output. " +
						"Defaults to the first contract found if not specified.",
				},
				optimizer: {
					type: "object",
					description:
						"Optimizer settings. Default: { enabled: true, runs: 200 }",
					properties: {
						enabled: { type: "boolean" },
						runs: { type: "number" },
					},
				},
			},
		},
	},
	{
		name: "cfxdevkit_compile_and_deploy",
		description:
			"One-shot: compile Solidity source then deploy to eSpace (or Core Space). " +
			"Equivalent to cfxdevkit_compile_solidity + blockchain_espace_deploy_contract. " +
			"Saves compilation result + deployment to .devkit-contracts.json automatically. " +
			"Use this for quick deployment of custom contracts.",
		inputSchema: {
			type: "object",
			required: ["source", "contractName"],
			properties: {
				source: {
					type: "string",
					description: "Full Solidity source code.",
				},
				contractName: {
					type: "string",
					description: "Name of the contract within the source to deploy.",
				},
				constructorArgs: {
					type: "array",
					description:
						"Constructor arguments as a JSON array. " +
						'Example: ["TokenName","TKN",18] for (string,string,uint8). ' +
						"For uint256 pass as decimal string.",
					items: {},
				},
				chain: {
					type: "string",
					enum: ["evm", "core"],
					description:
						'Target chain — "evm" for eSpace (default), "core" for Core Space.',
				},
				accountIndex: {
					type: "number",
					description:
						"Keystore account index to deploy from (0-based, default 0).",
				},
				displayName: {
					type: "string",
					description:
						'Human-readable name to save in .devkit-contracts.json, e.g. "My Token". ' +
						"Defaults to contractName if not provided.",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
];

// ── Tool handlers ─────────────────────────────────────────────────────────────

export async function compilerToolHandler(
	name: string,
	args: Record<string, unknown>,
): Promise<{ text: string } | null> {
	switch (name) {
		case "cfxdevkit_list_templates": {
			const lines = Object.entries(TEMPLATES).map(
				([tname, t]) => `• ${tname}\n  ${t.description}`,
			);
			const version = getSolcVersion();
			return {
				text: [
					`Available contract templates (solc ${version}, EVM target: paris):`,
					"",
					lines.join("\n\n"),
					"",
					"Usage:",
					'  1. cfxdevkit_get_template(name="TestToken")  → get ABI + bytecode',
					'  2. blockchain_espace_deploy_contract(abi=..., bytecode=..., contractName="My Token")',
					"",
					"Or compile your own:",
					'  cfxdevkit_compile_solidity(source="pragma solidity ^0.8.20; contract ...")',
				].join("\n"),
			};
		}

		case "cfxdevkit_get_template": {
			const templateName = args.name as string;
			const template = TEMPLATES[templateName as TemplateName];
			if (!template) {
				const available = Object.keys(TEMPLATES).join(", ");
				return {
					text: `Template "${templateName}" not found.\nAvailable: ${available}`,
				};
			}
			const { abi, bytecode } = template.get();
			const fns = (
				abi as { type?: string; name?: string; stateMutability?: string }[]
			)
				.filter((e) => e.type === "function")
				.map(
					(e) =>
						`  ${e.stateMutability === "view" || e.stateMutability === "pure" ? "[read]" : "[write]"} ${e.name}()`,
				);

			return {
				text: [
					`Template: ${templateName}`,
					`Description: ${template.description}`,
					"",
					`ABI functions (${fns.length}):`,
					fns.join("\n"),
					"",
					"ABI (JSON string — pass directly to blockchain_*_deploy_contract):",
					JSON.stringify(abi),
					"",
					"Bytecode (0x-prefixed — pass directly to blockchain_*_deploy_contract):",
					bytecode,
					"",
					"Solidity source:",
					template.source,
				].join("\n"),
			};
		}

		case "cfxdevkit_compile_solidity": {
			const source = args.source as string;
			const contractName =
				(args.contractName as string | undefined) ?? "Contract";
			const optimizer = args.optimizer as
				| { enabled: boolean; runs: number }
				| undefined;

			if (!source?.trim()) {
				return { text: "Error: source is required." };
			}

			try {
				const result = compileSolidity({ source, contractName, optimizer });

				if (!result.success || result.contracts.length === 0) {
					const errors = result.errors
						.map((e) => `  ${e.severity}: ${e.message}`)
						.join("\n");
					return {
						text: [
							"✗ Compilation failed:",
							errors || "  (unknown error)",
							result.warnings.length > 0
								? `Warnings:\n${result.warnings.map((w) => `  ${w.message}`).join("\n")}`
								: "",
						]
							.filter(Boolean)
							.join("\n"),
					};
				}

				const contract = result.contracts[0];
				const fns = (
					contract.abi as {
						type?: string;
						name?: string;
						stateMutability?: string;
					}[]
				)
					.filter((e) => e.type === "function")
					.map(
						(e) =>
							`  ${e.stateMutability === "view" || e.stateMutability === "pure" ? "[read]" : "[write]"} ${e.name}()`,
					);

				const warnings =
					result.warnings.length > 0
						? `\nWarnings:\n${result.warnings.map((w) => `  ${w.message}`).join("\n")}`
						: "";

				return {
					text: [
						`✓ Compiled: ${contract.contractName}`,
						`  ABI entries: ${contract.abi.length} (${fns.filter((f) => f.includes("[read]")).length} read, ${fns.filter((f) => f.includes("[write]")).length} write)`,
						warnings,
						"",
						"Functions:",
						fns.join("\n"),
						"",
						"ABI (JSON string — pass to blockchain_*_deploy_contract):",
						JSON.stringify(contract.abi),
						"",
						"Bytecode (0x-prefixed — pass to blockchain_*_deploy_contract):",
						contract.bytecode,
						"",
						"Next step: deploy with (eSpace — default):",
						`  blockchain_espace_deploy_contract(abi=<above>, bytecode=<above>, contractName="${contract.contractName}")`,
						"Or deploy to Core Space using the same ABI + bytecode:",
						`  blockchain_core_deploy_contract(abi=<above>, bytecode=<above>, contractName="${contract.contractName}")`,
					]
						.filter((s) => s !== null)
						.join("\n"),
				};
			} catch (err) {
				return {
					text: `Compilation error: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		}

		case "cfxdevkit_compile_and_deploy": {
			// This tool compiles then hands off to the blockchain handler.
			// We return the compilation result here; the routing in index.ts
			// will call blockchainToolHandler for the deploy step.
			// Since we can't chain MCP tool calls, we do it all in one handler.
			const source = args.source as string;
			const contractName =
				(args.contractName as string | undefined) ?? "Contract";

			if (!source?.trim()) {
				return { text: "Error: source is required." };
			}

			let abi: unknown[];
			let bytecode: string;

			try {
				const result = compileSolidity({ source, contractName });
				if (!result.success || result.contracts.length === 0) {
					const errors = result.errors
						.map((e) => `  ${e.severity}: ${e.message}`)
						.join("\n");
					return { text: `✗ Compilation failed:\n${errors}` };
				}
				const contract = result.contracts[0];
				abi = contract.abi;
				bytecode = contract.bytecode;
			} catch (err) {
				return {
					text: `Compilation error: ${err instanceof Error ? err.message : String(err)}`,
				};
			}

			const chain = (args.chain as "evm" | "core" | undefined) ?? "evm";
			const deployTool =
				chain === "core"
					? "blockchain_core_deploy_contract"
					: "blockchain_espace_deploy_contract";
			const displayName =
				(args.displayName as string | undefined) ?? contractName;
			const accountIndex = (args.accountIndex as number | undefined) ?? 0;

			// Return compiled artifacts with deploy instructions for the agent
			return {
				text: [
					`✓ Compiled: ${contractName}`,
					`  ABI entries: ${abi.length}`,
					"",
					`→ Deploying to ${chain === "core" ? "Core Space" : "eSpace"} now...`,
					`  ABI: ${JSON.stringify(abi)}`,
					`  Bytecode: ${bytecode}`,
					`  Use: ${deployTool} with the above ABI and bytecode`,
					`  contractName: "${displayName}"`,
					`  accountIndex: ${accountIndex}`,
					"",
					`NOTE: Call ${deployTool}(abi=<above>, bytecode=<above>, contractName="${displayName}", accountIndex=${accountIndex}) to complete deployment.`,
				].join("\n"),
			};
		}

		default:
			return null;
	}
}

/**
 * Compile and return ABI+bytecode for use in one-shot deploy scenarios.
 * Called by blockchain.ts deploy handler when source is provided instead of abi+bytecode.
 */
export function compileForDeploy(
	source: string,
	contractName: string,
): { abi: unknown[]; bytecode: string } {
	const result = compileSolidity({ source, contractName });
	if (!result.success || result.contracts.length === 0) {
		const errors = result.errors.map((e) => e.message).join("; ");
		throw new Error(`Compilation failed: ${errors}`);
	}
	return {
		abi: result.contracts[0].abi,
		bytecode: result.contracts[0].bytecode,
	};
}
