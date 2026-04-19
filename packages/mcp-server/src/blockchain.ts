/**
 * blockchain.ts — @cfxdevkit/core integration for the MCP server
 *
 * Provides blockchain interaction tools for both Conflux eSpace (EVM) and
 * Core Space. Uses @cfxdevkit/core for typed client abstractions and reads
 * accounts directly from the conflux-devkit keystore (~/.devkit.keystore.json).
 *
 * Tool categories:
 *  - Account tools (3): cfxdevkit_get_accounts, cfxdevkit_get_account, cfxdevkit_node_config
 *  - eSpace read  (7): balance, block, gas, chainId, callContract, readERC20, getTxReceipt
 *  - eSpace write (5): sendCFX, writeContract, deployContract, erc20Transfer, erc20Approve
 *  - Core read    (5): balance, block, chainId, callContract, readERC20
 *  - Core write   (5): sendCFX, writeContract, deployContract, erc20Transfer, erc20Approve
 *  - Contract mgmt(1): cfxdevkit_list_contracts
 *  - Wallet utils (4): deriveAccounts, validateMnemonic, generateMnemonic, signMessage
 *
 * Write tools accept either:
 *   accountIndex (int, default 0) — automatically reads private key from keystore
 *   privateKey   (0x-hex)         — explicit override (optional)
 *
 * Core Space address format depends on chainId:
 *   2029  → net2029:aa…   (local devkit)
 *   1     → cfxtest:aa…  (testnet)
 *   1029  → cfx:aa…      (mainnet)
 */

import {
	CoreClient,
	CoreWalletClient,
	deriveAccounts,
	deriveFaucetAccount,
	ERC20_ABI,
	EspaceClient,
	EspaceWalletClient,
	formatUnits,
	generateMnemonic,
	parseUnits,
	validateMnemonic,
} from "@cfxdevkit/core";
import {
	findContract,
	formatContractList,
	readContracts,
	saveContract,
} from "./contracts.js";
import {
	getAccount,
	getAccounts,
	getNodeConfig,
	resolvePrivateKey,
} from "./keystore.js";

// ── Default RPC endpoints ──────────────────────────────────────────────────────
const DEFAULT_ESPACE_RPC = "http://localhost:8545";
const DEFAULT_CORE_RPC = "http://localhost:12537";
const DEFAULT_CORE_CHAIN_ID = 2029; // local
const DEFAULT_ESPACE_CHAIN_ID = 2030; // local

// ── Helpers ───────────────────────────────────────────────────────────────────

/** JSON.stringify that handles bigint values */
function stringify(v: unknown): string {
	return JSON.stringify(
		v,
		(_k, val) => (typeof val === "bigint" ? val.toString() : val),
		2,
	);
}

/** Parse ABI — accepts a JSON string or pass-through array */
function parseAbi(abi: unknown): unknown[] {
	if (typeof abi === "string") {
		try {
			return JSON.parse(abi) as unknown[];
		} catch {
			throw new Error("Invalid ABI JSON string");
		}
	}
	if (Array.isArray(abi)) return abi;
	throw new Error("ABI must be a JSON string or array");
}

/**
 * Parse args — accepts a JSON string, a flat array, or a single-element array
 * whose only element is itself a JSON array string (agent double-nesting bug).
 *
 * Correct:  ["0xAddress", "20000000000000000000000"]
 * Also OK:  "[\"0xAddress\", \"20000000000000000000000\"]"  (JSON string)
 * Fixed:    ["[\"0xAddress\",\"20000...\"]"]  → unwrap the inner JSON
 */
function parseArgs(args: unknown): unknown[] {
	if (!args) return [];

	// String → try JSON parse
	if (typeof args === "string") {
		try {
			const parsed = JSON.parse(args);
			return Array.isArray(parsed) ? parsed : [parsed];
		} catch {
			return [];
		}
	}

	if (!Array.isArray(args)) return [];

	// Detect double-nesting: single-element array whose only element is a JSON array string
	if (
		args.length === 1 &&
		typeof args[0] === "string" &&
		(args[0] as string).trimStart().startsWith("[")
	) {
		try {
			const inner = JSON.parse(args[0] as string);
			if (Array.isArray(inner)) return inner;
		} catch {
			/* fall through */
		}
	}

	return args;
}

/**
 * Resolve the private key for a write operation.
 * Prefers an explicit privateKey if provided; otherwise reads from keystore
 * using accountIndex (0-based, default 0).
 */
function resolveKey(
	a: Record<string, unknown>,
	chain: "espace" | "core",
): string {
	if (
		a.privateKey &&
		typeof a.privateKey === "string" &&
		a.privateKey.startsWith("0x")
	) {
		return a.privateKey;
	}
	const index = typeof a.accountIndex === "number" ? a.accountIndex : 0;
	return resolvePrivateKey(index, chain);
}

function espaceClient(rpcUrl: string, chainId: number): EspaceClient {
	return new EspaceClient({ rpcUrl, chainId });
}

function coreClient(rpcUrl: string, chainId: number): CoreClient {
	return new CoreClient({ rpcUrl, chainId });
}

// ── MCP tool definitions ──────────────────────────────────────────────────────

export const blockchainToolDefinitions = [
	// ── Keystore / Account tools ──────────────────────────────────────────────
	{
		name: "cfxdevkit_get_accounts",
		description:
			"Get genesis development accounts from the conflux-devkit keystore. " +
			"Returns Core Space and eSpace addresses for all configured accounts. " +
			"Works offline — does NOT require the node to be running. " +
			"Core Space address format depends on network: " +
			"local=net2029:aa…, testnet=cfxtest:aa…, mainnet=cfx:aa… " +
			"NOTE: Private keys are NOT returned. Use accountIndex in write operations.",
		inputSchema: {
			type: "object",
			properties: {
				includeIndex: {
					type: "boolean",
					description: "Show account index (default: true)",
				},
			},
		},
	},
	{
		name: "cfxdevkit_get_account",
		description:
			"Get a single genesis account by index from the conflux-devkit keystore. " +
			"Returns Core Space and eSpace addresses. " +
			"Use accountIndex in write operations — private keys are NOT returned here.",
		inputSchema: {
			type: "object",
			required: ["index"],
			properties: {
				index: { type: "number", description: "Account index (0-based)" },
			},
		},
	},
	{
		name: "cfxdevkit_node_config",
		description:
			"Get the node configuration from the conflux-devkit keystore: " +
			"chainId, evmChainId, accountsCount, network name, Core address prefix. " +
			"Use this to confirm which network you are on before sending transactions.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "cfxdevkit_list_contracts",
		description:
			"List all smart contracts deployed via MCP tools. " +
			"Reads from .devkit-contracts.json in the workspace — persists across node restarts. " +
			"Shows name, address, chain, deployer, deploy timestamp, and whether ABI is stored.",
		inputSchema: { type: "object", properties: {} },
	},
	{
		name: "cfxdevkit_get_contract_info",
		description:
			"Get full info for a tracked contract by name or address. " +
			"Returns address, chain, deployer, deployedAt, and the stored ABI. " +
			"Use this before calling cfxdevkit_contract_call or cfxdevkit_contract_write " +
			"to inspect available functions without needing to provide the ABI manually.",
		inputSchema: {
			type: "object",
			required: ["nameOrAddress"],
			properties: {
				nameOrAddress: {
					type: "string",
					description: 'Contract name (e.g. "CDK Token") or 0x address',
				},
			},
		},
	},
	{
		name: "cfxdevkit_contract_call",
		description:
			"Call a read-only (view/pure) function on a tracked contract WITHOUT providing the ABI — " +
			"the ABI is loaded automatically from .devkit-contracts.json. " +
			"CHAIN AUTO-DETECTED: routes to eSpace or Core Space based on where the contract was deployed. " +
			"Works for both eSpace and Core Space contracts with no extra params. " +
			"Use cfxdevkit_get_contract_info first to see available functions. " +
			"ARGS: flat JSON array in parameter order. " +
			"ADDRESS FORMAT IN ARGS: Core Space contracts require Core base32 addresses (net2029:aa… / cfxtest:aa… / cfx:aa…) " +
			'from cfxdevkit_get_accounts "Core address" column — NOT the 0x eSpace address. ' +
			'eSpace contracts use 0x addresses. Example Core: args=["net2029:aak…"]. Example eSpace: args=["0xAddr"].',
		inputSchema: {
			type: "object",
			required: ["nameOrAddress", "functionName"],
			properties: {
				nameOrAddress: {
					type: "string",
					description: "Contract name or address",
				},
				functionName: {
					type: "string",
					description: "View/pure function name",
				},
				args: {
					type: "string",
					description:
						'Flat JSON array of args. Core contract address args → "net2029:aa…". eSpace → "0x…". uint256 → decimal string.',
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "cfxdevkit_contract_write",
		description:
			"Call a state-changing function on a tracked contract WITHOUT providing the ABI — " +
			"the ABI is loaded automatically from .devkit-contracts.json. " +
			"CHAIN AUTO-DETECTED: routes to eSpace or Core Space based on where the contract was deployed — " +
			"the same call works regardless of which chain the contract is on. " +
			"Use cfxdevkit_get_contract_info first to see available functions. " +
			"The caller account is resolved from the keystore by accountIndex (default 0). " +
			"ARGS: flat JSON array in parameter order. " +
			"ADDRESS FORMAT IN ARGS: Core Space contracts require Core base32 addresses (net2029:aa… / cfxtest:aa… / cfx:aa…) " +
			'from cfxdevkit_get_accounts "Core address" column — NOT the 0x eSpace address. ' +
			"Core and eSpace addresses are DIFFERENT derived addresses — never substitute one for the other. " +
			'Example Core contract mint: args=["net2029:aakxxxxxxxxx","20000000000000000000000"]. ' +
			'Example eSpace contract mint: args=["0xRecipient","20000000000000000000000"].',
		inputSchema: {
			type: "object",
			required: ["nameOrAddress", "functionName"],
			properties: {
				nameOrAddress: {
					type: "string",
					description: "Contract name or address",
				},
				functionName: { type: "string", description: "Function name" },
				args: {
					type: "string",
					description:
						"Flat JSON array of args in parameter order. uint256 → decimal string.",
				},
				accountIndex: {
					type: "number",
					description: "Caller account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				value: {
					type: "string",
					description: 'CFX to send with call (payable functions, e.g. "1.0")',
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "cfxdevkit_api_contract_call",
		description:
			"Call any function (read OR write) on a contract tracked by the **conflux-devkit server** " +
			"(the running node's own contract registry, separate from .devkit-contracts.json). " +
			"Routes through the devkit REST API POST /api/contracts/:id/call — uses the server's " +
			"stored ABI and private keys internally. " +
			"WHEN TO USE: when the contract was deployed via the conflux-devkit UI or API and has an " +
			"id in /api/contracts/deployed but may not be in .devkit-contracts.json. " +
			"For contracts in .devkit-contracts.json prefer cfxdevkit_contract_call / cfxdevkit_contract_write.",
		inputSchema: {
			type: "object",
			required: ["contractId", "functionName"],
			properties: {
				contractId: {
					type: "string",
					description:
						'Contract id from /api/contracts/deployed (e.g. "evm-1713000000000") or contract address',
				},
				functionName: { type: "string", description: "Function name to call" },
				args: {
					type: "array",
					description: "Arguments as a flat JSON array in parameter order.",
					items: {},
				},
				accountIndex: {
					type: "number",
					description: "Account index for write calls (default: 0)",
				},
				port: {
					type: "number",
					description: "Devkit server port (default: 7748)",
				},
			},
		},
	},
	// ── eSpace — read ─────────────────────────────────────────────────────────
	{
		name: "blockchain_espace_get_balance",
		description:
			"Get the native CFX balance of an address on Conflux eSpace (EVM-compatible). " +
			"Returns balance in CFX (decimal string) and wei. " +
			"Default RPC: http://localhost:8545 (local devkit node).",
		inputSchema: {
			type: "object",
			required: ["address"],
			properties: {
				address: { type: "string", description: "0x-prefixed eSpace address" },
				rpcUrl: {
					type: "string",
					description: "eSpace RPC URL (default: http://localhost:8545)",
				},
				chainId: {
					type: "number",
					description: "Chain ID (default: 2030 for local)",
				},
			},
		},
	},
	{
		name: "blockchain_espace_get_block_number",
		description:
			"Get the latest block number on Conflux eSpace. " +
			"Default RPC: http://localhost:8545.",
		inputSchema: {
			type: "object",
			properties: {
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_get_gas_price",
		description:
			"Get current gas price on Conflux eSpace in wei and Gwei. " +
			"Use this before sending transactions to estimate fees.",
		inputSchema: {
			type: "object",
			properties: {
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_get_chain_id",
		description:
			"Get the chain ID from the eSpace RPC endpoint. " +
			"Useful for verifying you are connected to the correct network (local=2030, testnet=71, mainnet=1030).",
		inputSchema: {
			type: "object",
			properties: {
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_call_contract",
		description:
			"Call a read-only (view/pure) function on any eSpace smart contract. " +
			"Does NOT require a private key or send a transaction. " +
			"ABI: JSON array (full or just the function fragment). " +
			"ARGS: JSON array of values in parameter order. " +
			'Example: args=["0xRecipient","1000000000000000000"] for (address,uint256). ' +
			'For uint256/large numbers always pass as a decimal string: "20000000000000000000000".',
		inputSchema: {
			type: "object",
			required: ["address", "abi", "functionName"],
			properties: {
				address: { type: "string", description: "Contract address (0x...)" },
				abi: {
					type: "string",
					description: "Contract ABI as JSON string or array",
				},
				functionName: {
					type: "string",
					description: "Name of the view/pure function to call",
				},
				args: {
					type: "array",
					description:
						"Arguments as a flat JSON array in parameter order. " +
						'Example: ["0xAddr","1000000000000000000"]. ' +
						"For uint256 pass as decimal string. " +
						'NEVER nest arrays: ["val1","val2"] is correct, ["[\\"val1\\",\\"val2\\""]"] is WRONG.',
					items: {},
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_read_erc20",
		description:
			"Read ERC-20 token information from eSpace: name, symbol, decimals, totalSupply, " +
			"and optionally the balance and allowance for a specific holder. " +
			"Great for inspecting deployed ERC20 tokens.",
		inputSchema: {
			type: "object",
			required: ["tokenAddress"],
			properties: {
				tokenAddress: {
					type: "string",
					description: "ERC20 token contract address (0x...)",
				},
				holderAddress: {
					type: "string",
					description: "Address to check balance for (optional)",
				},
				spenderAddress: {
					type: "string",
					description:
						"Spender to check allowance for (optional, requires holderAddress)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_erc20_transfer",
		description:
			"Transfer ERC-20 tokens to a recipient on eSpace. " +
			'Handles decimals automatically — amount is in human-readable units (e.g. "100" for 100 tokens). ' +
			"Reads token decimals, scales the amount, and calls transfer(). " +
			"Specify the sender by accountIndex (default: 0) or explicit privateKey.",
		inputSchema: {
			type: "object",
			required: ["tokenAddress", "to", "amount"],
			properties: {
				tokenAddress: {
					type: "string",
					description: "ERC-20 token contract address (0x…)",
				},
				to: { type: "string", description: "Recipient address (0x…)" },
				amount: {
					type: "string",
					description:
						'Amount in human-readable units (e.g. "100" for 100 tokens). Decimals handled automatically.',
				},
				accountIndex: {
					type: "number",
					description: "Sender account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_erc20_approve",
		description:
			"Approve a spender to transfer ERC-20 tokens on your behalf (eSpace). " +
			"Amount is in human-readable units — decimals handled automatically. " +
			'Use amount="unlimited" for max uint256 approval. ' +
			"Specify the token owner by accountIndex (default: 0) or explicit privateKey.",
		inputSchema: {
			type: "object",
			required: ["tokenAddress", "spender", "amount"],
			properties: {
				tokenAddress: {
					type: "string",
					description: "ERC-20 token contract address (0x…)",
				},
				spender: {
					type: "string",
					description: "Address to approve as spender (0x…)",
				},
				amount: {
					type: "string",
					description:
						'Amount in human-readable units (e.g. "1000"), or "unlimited" for max approval. Decimals handled automatically.',
				},
				accountIndex: {
					type: "number",
					description: "Token owner account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_get_tx_receipt",
		inputSchema: {
			type: "object",
			required: ["txHash"],
			properties: {
				txHash: { type: "string", description: "0x-prefixed transaction hash" },
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	// ── eSpace — write ────────────────────────────────────────────────────────
	{
		name: "blockchain_espace_send_cfx",
		description:
			"Send CFX on eSpace. Specify the sender by accountIndex (0-based, default 0) — " +
			"the private key is resolved automatically from the conflux-devkit keystore. " +
			"Alternatively, pass privateKey explicitly (0x-prefixed) to override. " +
			'amount is in CFX (e.g. "10" for 10 CFX).',
		inputSchema: {
			type: "object",
			required: ["to", "amount"],
			properties: {
				to: { type: "string", description: "Recipient 0x address" },
				amount: { type: "string", description: 'Amount in CFX (e.g. "10.5")' },
				accountIndex: {
					type: "number",
					description: "Sender account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_write_contract",
		description:
			"Call a state-changing function on any eSpace smart contract (sends a transaction). " +
			"Specify the caller by accountIndex (0-based, default 0) — key resolved from keystore. " +
			"ABI: JSON string or array. " +
			'ARGS: flat JSON array in parameter order, e.g. args=["0xRecipient","20000000000000000000000"]. ' +
			"For uint256/large numbers always pass as decimal strings. " +
			'Do NOT double-nest: wrong=["[\\"0x...\\",\\"2000...\\""]"], correct=["0x...","2000..."]. ' +
			"VALUE: optional CFX to send (payable functions only).",
		inputSchema: {
			type: "object",
			required: ["address", "abi", "functionName"],
			properties: {
				address: { type: "string", description: "Contract address (0x...)" },
				abi: { type: "string", description: "Contract ABI as JSON string" },
				functionName: { type: "string", description: "Function name to call" },
				args: {
					type: "string",
					description:
						'Flat JSON array in parameter order, e.g. ["0xAddr","1000000000000000000"]. uint256 → decimal string. Never double-nest: ["val1","val2"] not ["["val1","val2"]"]',
				},
				value: {
					type: "string",
					description: 'CFX to send with the call (payable, e.g. "1.0")',
				},
				accountIndex: {
					type: "number",
					description: "Caller account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_espace_deploy_contract",
		description:
			"Deploy a compiled smart contract to eSpace. " +
			"Returns the deployed contract address. " +
			"Specify the deployer by accountIndex (0-based, default 0) — key resolved from keystore. " +
			"Provide a contractName so the deployment is tracked in .devkit-contracts.json. " +
			"CONSTRUCTOR_ARGS: JSON array of values for the constructor. " +
			"You can either provide abi+bytecode (pre-compiled) OR source+contractName (auto-compile with solc 0.8.28).",
		inputSchema: {
			type: "object",
			properties: {
				abi: {
					type: "string",
					description:
						"Contract ABI as JSON string (required if not providing source)",
				},
				bytecode: {
					type: "string",
					description:
						"Compiled bytecode 0x-prefixed (required if not providing source)",
				},
				source: {
					type: "string",
					description:
						"Solidity source code — auto-compiles with solc 0.8.28 (paris EVM target). Use instead of abi+bytecode.",
				},
				constructorArgs: {
					type: "string",
					description: "JSON array of constructor arguments (default: [])",
				},
				contractName: {
					type: "string",
					description:
						"Contract name in source (for auto-compile) and/or human-readable name for tracking in .devkit-contracts.json",
				},
				accountIndex: {
					type: "number",
					description: "Deployer account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	// ── Core Space — read ─────────────────────────────────────────────────────
	{
		name: "blockchain_core_get_balance",
		description:
			"Get the native CFX balance of an address on Conflux Core Space. " +
			"IMPORTANT: Use Core Space base32 addresses (net2029:… for local, cfxtest:… for testnet, cfx:… for mainnet). " +
			"0x addresses may not resolve correctly on Core Space. " +
			"Get Core addresses from conflux_accounts or cfxdevkit_get_accounts. " +
			"Returns balance in CFX. Default RPC: http://localhost:12537.",
		inputSchema: {
			type: "object",
			required: ["address"],
			properties: {
				address: {
					type: "string",
					description:
						"Core Space address (net2029:… / cfxtest:… / cfx:…) or hex",
				},
				rpcUrl: {
					type: "string",
					description: "Core Space RPC URL (default: http://localhost:12537)",
				},
				chainId: {
					type: "number",
					description: "Chain ID (default: 2029 for local)",
				},
			},
		},
	},
	{
		name: "blockchain_core_get_block_number",
		description:
			"Get the latest epoch number on Conflux Core Space (equivalent to block number). " +
			"Default RPC: http://localhost:12537.",
		inputSchema: {
			type: "object",
			properties: {
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_get_chain_id",
		description:
			"Get the network ID from the Core Space RPC endpoint. " +
			"Local node = 2029, testnet = 1, mainnet = 1029. " +
			"Core address prefix: local=net2029, testnet=cfxtest, mainnet=cfx.",
		inputSchema: {
			type: "object",
			properties: {
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_call_contract",
		description:
			"Call a read-only (view/pure) function on a Conflux Core Space contract. " +
			"Does not require a private key. " +
			"IMPORTANT: 0x addresses will FAIL on Core Space — use base32 format (net2029:… for local, cfxtest:… for testnet, cfx:… for mainnet). " +
			"Get Core addresses from cfxdevkit_get_accounts or conflux_accounts. " +
			"ABI as JSON string, ARGS as JSON array.",
		inputSchema: {
			type: "object",
			required: ["address", "abi", "functionName"],
			properties: {
				address: {
					type: "string",
					description:
						"Core contract address — MUST be base32 format (net2029:… / cfxtest:… / cfx:…). NOT 0x.",
				},
				abi: { type: "string", description: "Contract ABI as JSON string" },
				functionName: {
					type: "string",
					description: "View/pure function to call",
				},
				args: {
					type: "string",
					description:
						"Flat JSON array in parameter order. Address args MUST be Core base32 (net2029:…), NOT 0x. " +
						'Example: ["net2029:aam…","1000000000000000000"]. uint256 → decimal string. Never double-nest.',
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_read_erc20",
		description:
			"Read ERC-20 (CRC-20) token information from Core Space: name, symbol, decimals, totalSupply, " +
			"and optionally the balance and allowance for a specific holder. " +
			"IMPORTANT: All addresses MUST be Core base32 format (net2029:… / cfxtest:… / cfx:…), NOT 0x.",
		inputSchema: {
			type: "object",
			required: ["tokenAddress"],
			properties: {
				tokenAddress: {
					type: "string",
					description:
						"Token contract address — MUST be Core base32 (net2029:… / cfxtest:… / cfx:…)",
				},
				holderAddress: {
					type: "string",
					description: "Core base32 address to check balance for (optional)",
				},
				spenderAddress: {
					type: "string",
					description:
						"Core base32 spender to check allowance for (optional, requires holderAddress)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	// ── Core Space — write ────────────────────────────────────────────────────
	{
		name: "blockchain_core_send_cfx",
		description:
			"Send CFX on Core Space. Specify the sender by accountIndex (0-based, default 0). " +
			"Auto-detects the recipient: 0x address → cross-chain transfer to eSpace; " +
			"Core address (net2029:… / cfxtest:… / cfx:…) → direct Core Space transfer. " +
			"amount is in CFX.",
		inputSchema: {
			type: "object",
			required: ["to", "amount"],
			properties: {
				to: {
					type: "string",
					description: "Recipient: Core address or eSpace 0x address",
				},
				amount: { type: "string", description: 'Amount in CFX (e.g. "100")' },
				accountIndex: {
					type: "number",
					description: "Sender account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description:
						"0x-prefixed Core Space private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_write_contract",
		description:
			"Call a state-changing function on a Conflux Core Space contract (sends a transaction). " +
			"Specify the caller by accountIndex (0-based, default 0) — key resolved from keystore. " +
			"IMPORTANT: Contract and arg addresses MUST be Core base32 format (net2029:… / cfxtest:… / cfx:…), NOT 0x.",
		inputSchema: {
			type: "object",
			required: ["address", "abi", "functionName"],
			properties: {
				address: {
					type: "string",
					description:
						"Core contract address — MUST be base32 (net2029:… / cfxtest:… / cfx:…)",
				},
				abi: { type: "string", description: "Contract ABI as JSON string" },
				functionName: { type: "string", description: "Function name to call" },
				args: {
					type: "string",
					description:
						"Flat JSON array in parameter order. Address args MUST be Core base32 (net2029:…), NOT 0x. " +
						'Example: ["net2029:aam…","1000000000000000000"]. uint256 → decimal string. Never double-nest.',
				},
				value: {
					type: "string",
					description: 'CFX value to send with call (payable, e.g. "1.0")',
				},
				accountIndex: {
					type: "number",
					description: "Caller account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description:
						"0x-prefixed Core Space private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_erc20_transfer",
		description:
			"Transfer ERC-20 (CRC-20) tokens to a recipient on Core Space. " +
			'Handles decimals automatically — amount is in human-readable units (e.g. "100" for 100 tokens). ' +
			"IMPORTANT: All addresses MUST be Core base32 format (net2029:… / cfxtest:… / cfx:…), NOT 0x. " +
			"Specify the sender by accountIndex (default: 0) or explicit privateKey.",
		inputSchema: {
			type: "object",
			required: ["tokenAddress", "to", "amount"],
			properties: {
				tokenAddress: {
					type: "string",
					description:
						"Token contract address — MUST be Core base32 (net2029:… / cfxtest:… / cfx:…)",
				},
				to: {
					type: "string",
					description:
						"Recipient — MUST be Core base32 (net2029:… / cfxtest:… / cfx:…)",
				},
				amount: {
					type: "string",
					description:
						'Amount in human-readable units (e.g. "100" for 100 tokens). Decimals handled automatically.',
				},
				accountIndex: {
					type: "number",
					description: "Sender account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_erc20_approve",
		description:
			"Approve a spender to transfer ERC-20 (CRC-20) tokens on your behalf (Core Space). " +
			"Amount is in human-readable units — decimals handled automatically. " +
			'Use amount="unlimited" for max uint256 approval. ' +
			"IMPORTANT: All addresses MUST be Core base32 format (net2029:… / cfxtest:… / cfx:…), NOT 0x. " +
			"Specify the token owner by accountIndex (default: 0) or explicit privateKey.",
		inputSchema: {
			type: "object",
			required: ["tokenAddress", "spender", "amount"],
			properties: {
				tokenAddress: {
					type: "string",
					description:
						"Token contract address — MUST be Core base32 (net2029:… / cfxtest:… / cfx:…)",
				},
				spender: {
					type: "string",
					description:
						"Address to approve as spender — MUST be Core base32 (net2029:… / cfxtest:… / cfx:…)",
				},
				amount: {
					type: "string",
					description:
						'Amount in human-readable units (e.g. "1000"), or "unlimited" for max approval. Decimals handled automatically.',
				},
				accountIndex: {
					type: "number",
					description: "Token owner account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description: "0x-prefixed private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	{
		name: "blockchain_core_deploy_contract",
		description:
			"Deploy a compiled contract to Conflux Core Space. " +
			"Returns the deployed Core base32 contract address and tracks it in .devkit-contracts.json. " +
			"Constructor address args MUST use Core base32 format (net2029:… / cfxtest:… / cfx:…), NOT 0x. " +
			"Specify the deployer by accountIndex (0-based, default 0) — key resolved from keystore. " +
			"Provide a contractName for tracking. " +
			"You can either provide abi+bytecode (pre-compiled) OR source+contractName (auto-compile with solc 0.8.28).",
		inputSchema: {
			type: "object",
			properties: {
				abi: {
					type: "string",
					description:
						"Contract ABI as JSON string (required if not providing source)",
				},
				bytecode: {
					type: "string",
					description:
						"Compiled bytecode 0x-prefixed (required if not providing source)",
				},
				source: {
					type: "string",
					description:
						"Solidity source — auto-compiles instead of abi+bytecode",
				},
				constructorArgs: {
					type: "string",
					description: "JSON array of constructor arguments (default: [])",
				},
				contractName: {
					type: "string",
					description:
						"Contract name in source and/or human-readable name for tracking",
				},
				accountIndex: {
					type: "number",
					description: "Deployer account index from keystore (default: 0)",
				},
				privateKey: {
					type: "string",
					description:
						"0x-prefixed Core Space private key (overrides accountIndex)",
				},
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
	// ── Wallet tools ──────────────────────────────────────────────────────────
	{
		name: "blockchain_derive_accounts",
		description:
			"Derive HD wallet accounts from a BIP-39 mnemonic phrase. " +
			"Returns both Core Space (cfx:...) and eSpace (0x...) addresses AND their private keys " +
			"for each derived account index. " +
			"Use this to get private keys for the genesis accounts after calling conflux_keystore_generate. " +
			"IMPORTANT: The faucet/mining account uses a separate derivation path — use includeFaucet:true to include it.",
		inputSchema: {
			type: "object",
			required: ["mnemonic"],
			properties: {
				mnemonic: {
					type: "string",
					description: "BIP-39 12 or 24 word mnemonic phrase",
				},
				count: {
					type: "number",
					description: "Number of accounts to derive (default: 5)",
				},
				startIndex: { type: "number", description: "Start index (default: 0)" },
				coreNetworkId: {
					type: "number",
					description:
						"Core Space network ID for address encoding (default: 2029 for local)",
				},
				includeFaucet: {
					type: "boolean",
					description: "Also derive the faucet/mining account (default: true)",
				},
			},
		},
	},
	{
		name: "blockchain_validate_mnemonic",
		description:
			"Validate a BIP-39 mnemonic phrase. " +
			"Returns whether it is valid, the word count, and any error message.",
		inputSchema: {
			type: "object",
			required: ["mnemonic"],
			properties: {
				mnemonic: {
					type: "string",
					description: "Mnemonic phrase to validate",
				},
			},
		},
	},
	{
		name: "blockchain_generate_mnemonic",
		description:
			"Generate a new random BIP-39 mnemonic phrase. " +
			"NOTE: This creates a NEW random mnemonic — it is NOT the devkit keystore mnemonic. " +
			"To get private keys for devkit genesis accounts, use blockchain_derive_accounts with " +
			"the mnemonic from the keystore setup.",
		inputSchema: {
			type: "object",
			properties: {
				strength: {
					type: "number",
					enum: [128, 256],
					description: "128 for 12 words (default), 256 for 24 words",
				},
			},
		},
	},
	{
		name: "blockchain_espace_sign_message",
		description:
			"Sign an arbitrary message with an eSpace private key (EIP-191 personal_sign). " +
			"Returns the signature as a 0x-prefixed hex string.",
		inputSchema: {
			type: "object",
			required: ["message", "privateKey"],
			properties: {
				message: { type: "string", description: "Message to sign" },
				privateKey: { type: "string", description: "0x-prefixed private key" },
				rpcUrl: { type: "string" },
				chainId: { type: "number" },
			},
		},
	},
] as const;

// ── Tool handler ──────────────────────────────────────────────────────────────

export async function blockchainToolHandler(
	name: string,
	a: Record<string, unknown>,
): Promise<{ text: string; isError?: boolean }> {
	const espaceRpc = (a.rpcUrl as string | undefined) ?? DEFAULT_ESPACE_RPC;
	const coreRpc = (a.rpcUrl as string | undefined) ?? DEFAULT_CORE_RPC;
	const espaceChainId =
		(a.chainId as number | undefined) ?? DEFAULT_ESPACE_CHAIN_ID;
	const coreChainId =
		(a.chainId as number | undefined) ?? DEFAULT_CORE_CHAIN_ID;

	switch (name) {
		// ── Keystore / Account tools ──────────────────────────────────────────────

		case "cfxdevkit_get_accounts": {
			const accounts = getAccounts();
			const lines = [`Genesis Accounts (${accounts.length} total)\n`];
			for (const acc of accounts) {
				lines.push(`Account #${acc.index}`);
				lines.push(
					`  Core address:   ${acc.coreAddress}   <- use for Core Space operations`,
				);
				lines.push(
					`  eSpace address: ${acc.evmAddress}   <- use for eSpace (EVM) operations`,
				);
			}
			lines.push("\nADDRESS FORMAT RULES:");
			lines.push(
				'  Core Space operations  -> always pass the "Core address" (net2029:aa… / cfxtest:aa… / cfx:aa…)',
			);
			lines.push(
				'  eSpace operations      -> always pass the "eSpace address" (0x…)',
			);
			lines.push(
				"  These are DIFFERENT addresses — do NOT use a 0x address for Core or vice-versa.",
			);
			lines.push(
				"\nTo use an account in transactions, pass accountIndex (e.g. 0, 1, 2…).",
			);
			return { text: lines.join("\n") };
		}

		case "cfxdevkit_get_account": {
			const acc = getAccount(a.index as number);
			return {
				text: [
					`Account #${acc.index}`,
					`  Core address:   ${acc.coreAddress}   (Core Space — net2029:aa… / cfxtest:aa… / cfx:aa…)`,
					`  eSpace address: ${acc.evmAddress}   (eSpace/EVM — 0x…)`,
					"",
					"ADDRESS RULE: Core and eSpace addresses are DIFFERENT. Use Core address for Core operations,",
					"eSpace address for eSpace operations. Never use a 0x address where a Core address is needed.",
					"Use accountIndex in write operations — private keys are NOT returned here.",
				].join("\n"),
			};
		}

		case "cfxdevkit_node_config": {
			const cfg = getNodeConfig();
			return {
				text: [
					`Network:           ${cfg.networkName}`,
					`Core chainId:      ${cfg.chainId}`,
					`eSpace chainId:    ${cfg.evmChainId}`,
					`Accounts count:    ${cfg.accountsCount}`,
					`Core addr prefix:  ${cfg.coreAddressPrefix}`,
					"",
					"Address format examples:",
					`  local   → net2029:aakxxxxxxxxxx`,
					`  testnet → cfxtest:aakxxxxxxxxxx`,
					`  mainnet → cfx:aakxxxxxxxxxx`,
				].join("\n"),
			};
		}

		case "cfxdevkit_list_contracts": {
			const contracts = await readContracts();
			return { text: formatContractList(contracts) };
		}

		case "cfxdevkit_get_contract_info": {
			const contract = await findContract(a.nameOrAddress as string);
			if (!contract) {
				const all = (await readContracts())
					.map((c) => `  • ${c.name} (${c.address})`)
					.join("\n");
				return {
					text: `Contract "${a.nameOrAddress}" not found.\n\nTracked contracts:\n${all || "  (none)"}`,
					isError: true,
				};
			}
			let abiFunctions = "(not stored)";
			if (contract.abi) {
				try {
					const parsed = (contract.abi ?? []) as {
						type?: string;
						name?: string;
						stateMutability?: string;
					}[];
					const fns = parsed.filter((e) => e.type === "function");
					const reads = fns.filter(
						(e) => e.stateMutability === "view" || e.stateMutability === "pure",
					);
					const writes = fns.filter(
						(e) => e.stateMutability !== "view" && e.stateMutability !== "pure",
					);
					abiFunctions = [
						`  READ  (${reads.length}): ${reads.map((e) => e.name).join(", ")}`,
						`  WRITE (${writes.length}): ${writes.map((e) => e.name).join(", ")}`,
					].join("\n");
				} catch {
					abiFunctions = "(stored but could not parse)";
				}
			}
			return {
				text: [
					`Contract: ${contract.name}`,
					`Address:  ${contract.address}`,
					`Chain:    ${contract.chain === "evm" ? "eSpace" : "Core Space"} (chainId ${contract.chainId})`,
					`Deployer: ${contract.deployer}`,
					`Deployed: ${new Date(contract.deployedAt).toLocaleString()}`,
					contract.txHash ? `Tx:       ${contract.txHash}` : "",
					"",
					"ABI functions:",
					abiFunctions,
					"",
					"Use cfxdevkit_contract_call / cfxdevkit_contract_write with this contract name.",
				]
					.filter((l) => l !== undefined)
					.join("\n"),
			};
		}

		case "cfxdevkit_contract_call": {
			const contract = await findContract(a.nameOrAddress as string);
			if (!contract) {
				return {
					text: `Contract "${a.nameOrAddress}" not found. Run cfxdevkit_list_contracts to see tracked contracts.`,
					isError: true,
				};
			}
			if (!contract.abi) {
				return {
					text: `Contract "${contract.name}" has no stored ABI. Use blockchain_espace_call_contract or blockchain_core_call_contract and provide the ABI manually.`,
					isError: true,
				};
			}
			const rpc =
				(a.rpcUrl as string | undefined) ??
				(contract.chain === "evm" ? DEFAULT_ESPACE_RPC : DEFAULT_CORE_RPC);
			const chainId = (a.chainId as number | undefined) ?? contract.chainId;
			const abi = parseAbi(contract.abi);
			const args = parseArgs(a.args);

			let result: unknown;
			if (contract.chain === "evm") {
				const client = espaceClient(rpc, chainId);
				const pub = client.getInternalClient() as {
					readContract: (opts: unknown) => Promise<unknown>;
				};
				result = await pub.readContract({
					address: contract.address as `0x${string}`,
					abi,
					functionName: a.functionName as string,
					args,
				});
			} else {
				const client = coreClient(rpc, chainId);
				const pub = client.getInternalClient() as {
					readContract: (opts: unknown) => Promise<unknown>;
				};
				result = await pub.readContract({
					address: contract.address as string,
					abi,
					functionName: a.functionName as string,
					args,
				});
			}
			const addressNote =
				contract.chain !== "evm"
					? `\nNote: This is a Core Space contract. Address arguments must be Core format (net2029:aa\u2026 / cfxtest:aa\u2026). Get from cfxdevkit_get_accounts \u201cCore address\u201d column.`
					: "";
			return {
				text: [
					`Contract:  ${contract.name} (${contract.address})`,
					`Chain:     ${contract.chain === "evm" ? "eSpace" : "Core Space"}`,
					`Function:  ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
					`Result:    ${stringify(result)}`,
					addressNote,
				]
					.filter(Boolean)
					.join("\n"),
			};
		}

		case "cfxdevkit_contract_write": {
			const contract = await findContract(a.nameOrAddress as string);
			if (!contract) {
				return {
					text: `Contract "${a.nameOrAddress}" not found. Run cfxdevkit_list_contracts to see tracked contracts.`,
					isError: true,
				};
			}
			if (!contract.abi) {
				return {
					text: `Contract "${contract.name}" has no stored ABI. Use blockchain_espace_write_contract or blockchain_core_write_contract and provide the ABI manually.`,
					isError: true,
				};
			}
			const rpc =
				(a.rpcUrl as string | undefined) ??
				(contract.chain === "evm" ? DEFAULT_ESPACE_RPC : DEFAULT_CORE_RPC);
			const chainId = (a.chainId as number | undefined) ?? contract.chainId;
			const abi = parseAbi(contract.abi);
			const args = parseArgs(a.args);
			const value = a.value ? parseUnits(a.value as string, 18) : undefined;

			if (contract.chain === "evm") {
				const wallet = new EspaceWalletClient({
					rpcUrl: rpc,
					chainId,
					privateKey: resolveKey(a, "espace"),
				});
				const hash = await wallet.writeContract(
					contract.address,
					abi,
					a.functionName as string,
					args,
					value,
				);
				const receipt = await wallet.waitForTransaction(hash);
				return {
					text: [
						`Contract:  ${contract.name} (${contract.address})`,
						`Chain:     eSpace`,
						`Function:  ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
						`Tx Hash:   ${hash}`,
						`Status:    ${receipt.status}`,
						`Block:     #${receipt.blockNumber}`,
						`Gas Used:  ${receipt.gasUsed}`,
					].join("\n"),
				};
			} else {
				const wallet = new CoreWalletClient({
					rpcUrl: rpc,
					chainId,
					privateKey: resolveKey(a, "core"),
				});
				const valueCore = a.value
					? BigInt(Math.floor(parseFloat(a.value as string) * 1e18))
					: undefined;
				const hash = await wallet.writeContract(
					contract.address,
					abi,
					a.functionName as string,
					args,
					valueCore,
				);
				const receipt = await wallet.waitForTransaction(hash);
				return {
					text: [
						`Contract:  ${contract.name} (${contract.address})`,
						`Chain:     Core Space`,
						`Function:  ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
						`Tx Hash:   ${hash}`,
						`Status:    ${receipt.status}`,
						`Epoch:     #${receipt.blockNumber}`,
						`Gas Used:  ${receipt.gasUsed}`,
						`Note: address args for Core contracts must use Core format (net2029:aa\u2026), not 0x.`,
					].join("\n"),
				};
			}
		}

		// ── eSpace read ─────────────────────────────────────────────────────────

		case "cfxdevkit_api_contract_call": {
			const port = (a.port as number | undefined) ?? 7748;
			const base = `http://localhost:${port}`;
			const contractIdOrAddr = a.contractId as string;
			const functionName = a.functionName as string;
			const args = parseArgs(a.args);
			const accountIndex = (a.accountIndex as number | undefined) ?? 0;

			// Resolve contract id — could be an address or an id like "evm-1713000000000"
			let contractId = contractIdOrAddr;
			if (contractIdOrAddr.startsWith("0x")) {
				// Look up by address in deployed list
				const listRes = await fetch(`${base}/api/contracts/deployed`);
				if (!listRes.ok) {
					return {
						text: `Failed to fetch contracts from devkit API: ${listRes.statusText}`,
						isError: true,
					};
				}
				const contracts = (await listRes.json()) as {
					id: string;
					address: string;
				}[];
				const found = contracts.find(
					(c) => c.address.toLowerCase() === contractIdOrAddr.toLowerCase(),
				);
				if (!found) {
					return {
						text: `No contract with address ${contractIdOrAddr} found in devkit API. Use cfxdevkit_list_contracts for MCP-tracked contracts.`,
						isError: true,
					};
				}
				contractId = found.id;
			}

			const callRes = await fetch(
				`${base}/api/contracts/${encodeURIComponent(contractId)}/call`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ functionName, args, accountIndex }),
				},
			);

			const data = (await callRes.json()) as {
				success?: boolean;
				result?: unknown;
				txHash?: string;
				blockNumber?: string;
				status?: string;
				error?: string;
			};

			if (!callRes.ok || !data.success) {
				return {
					text: `API call failed: ${data.error ?? callRes.statusText}`,
					isError: true,
				};
			}

			if (data.txHash) {
				// Write call
				return {
					text: [
						`✓ Transaction sent via devkit API`,
						`Function:  ${functionName}(${args.length ? stringify(args) : ""})`,
						`Tx Hash:   ${data.txHash}`,
						`Status:    ${data.status ?? "unknown"}`,
						`Block:     #${data.blockNumber ?? "?"}`,
					].join("\n"),
				};
			}

			// Read call
			const resultStr =
				typeof data.result === "object"
					? JSON.stringify(data.result)
					: String(data.result);
			return {
				text: [
					`${functionName}(${args.length ? stringify(args) : ""}) → ${resultStr}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_get_balance": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const address = a.address as string;
			const cfx = await client.getBalance(address as `0x${string}`);
			const blockNum = await client.getBlockNumber();
			return {
				text: [
					`Address:      ${address}`,
					`Balance:      ${cfx} CFX`,
					`Block:        #${blockNum}`,
					`Network:      eSpace (chainId ${espaceChainId})`,
					`RPC:          ${espaceRpc}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_get_block_number": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const blockNum = await client.getBlockNumber();
			return {
				text: `Latest block: #${blockNum}\nNetwork: eSpace (chainId ${espaceChainId})\nRPC: ${espaceRpc}`,
			};
		}

		case "blockchain_espace_get_gas_price": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const gasPrice = await client.getGasPrice();
			const gwei = formatUnits(gasPrice, 9);
			return {
				text: [
					`Gas Price:    ${gasPrice} wei`,
					`              ${gwei} Gwei`,
					`Network:      eSpace (chainId ${espaceChainId})`,
					`RPC:          ${espaceRpc}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_get_chain_id": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const chainId = await client.getChainId();
			const known: Record<number, string> = {
				2030: "local devkit",
				71: "testnet",
				1030: "mainnet",
			};
			return {
				text: `Chain ID: ${chainId} (${known[chainId] ?? "unknown network"})\nRPC: ${espaceRpc}`,
			};
		}

		case "blockchain_espace_call_contract": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const abi = parseAbi(a.abi);
			const args = parseArgs(a.args);
			const result = await client.publicClient.readContract({
				address: a.address as `0x${string}`,
				abi,
				functionName: a.functionName as string,
				args,
			});
			return {
				text: [
					`Contract:     ${a.address}`,
					`Function:     ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
					`Result:       ${stringify(result)}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_read_erc20": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const addr = a.tokenAddress as `0x${string}`;
			const [name, symbol, decimals, totalSupply] = await Promise.all([
				client.publicClient.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "name",
				}) as Promise<string>,
				client.publicClient.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "symbol",
				}) as Promise<string>,
				client.publicClient.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "decimals",
				}) as Promise<number>,
				client.publicClient.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "totalSupply",
				}) as Promise<bigint>,
			]);
			const lines = [
				`Token:        ${name} (${symbol})`,
				`Address:      ${addr}`,
				`Decimals:     ${decimals}`,
				`Total Supply: ${formatUnits(totalSupply, decimals)} ${symbol}`,
			];
			if (a.holderAddress) {
				const balance = (await client.publicClient.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "balanceOf",
					args: [a.holderAddress as `0x${string}`],
				})) as bigint;
				lines.push(`Holder:       ${a.holderAddress}`);
				lines.push(`Balance:      ${formatUnits(balance, decimals)} ${symbol}`);
				if (a.spenderAddress) {
					const allowance = (await client.publicClient.readContract({
						address: addr,
						abi: ERC20_ABI,
						functionName: "allowance",
						args: [
							a.holderAddress as `0x${string}`,
							a.spenderAddress as `0x${string}`,
						],
					})) as bigint;
					lines.push(
						`Allowance:    ${formatUnits(allowance, decimals)} ${symbol} (for ${a.spenderAddress})`,
					);
				}
			}
			return { text: lines.join("\n") };
		}

		case "blockchain_espace_erc20_transfer": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const wallet = new EspaceWalletClient({
				rpcUrl: espaceRpc,
				chainId: espaceChainId,
				privateKey: resolveKey(a, "espace"),
			});
			const addr = a.tokenAddress as `0x${string}`;
			const decimals = (await client.publicClient.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "decimals",
			})) as number;
			const symbol = (await client.publicClient.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "symbol",
			})) as string;
			const rawAmount = parseUnits(a.amount as string, decimals);
			const hash = await wallet.writeContract(
				addr,
				[...ERC20_ABI] as unknown[],
				"transfer",
				[a.to as string, rawAmount],
			);
			const receipt = await wallet.waitForTransaction(hash);
			return {
				text: [
					`Transferred:  ${a.amount} ${symbol}`,
					`From:         ${wallet.address}`,
					`To:           ${a.to}`,
					`Token:        ${addr}`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Block:        #${receipt.blockNumber}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_erc20_approve": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const wallet = new EspaceWalletClient({
				rpcUrl: espaceRpc,
				chainId: espaceChainId,
				privateKey: resolveKey(a, "espace"),
			});
			const addr = a.tokenAddress as `0x${string}`;
			const decimals = (await client.publicClient.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "decimals",
			})) as number;
			const symbol = (await client.publicClient.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "symbol",
			})) as string;
			const MAX_UINT256 = BigInt(
				"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			);
			const rawAmount =
				(a.amount as string).toLowerCase() === "unlimited"
					? MAX_UINT256
					: parseUnits(a.amount as string, decimals);
			const hash = await wallet.writeContract(
				addr,
				[...ERC20_ABI] as unknown[],
				"approve",
				[a.spender as string, rawAmount],
			);
			const receipt = await wallet.waitForTransaction(hash);
			const displayAmount =
				rawAmount === MAX_UINT256 ? "unlimited" : `${a.amount} ${symbol}`;
			return {
				text: [
					`Approved:     ${displayAmount}`,
					`Owner:        ${wallet.address}`,
					`Spender:      ${a.spender}`,
					`Token:        ${addr}`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Block:        #${receipt.blockNumber}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_get_tx_receipt": {
			const client = espaceClient(espaceRpc, espaceChainId);
			const receipt = await client.waitForTransaction(a.txHash as string);
			return {
				text: [
					`Tx Hash:      ${receipt.hash}`,
					`Status:       ${receipt.status}`,
					`Block:        #${receipt.blockNumber}`,
					`Gas Used:     ${receipt.gasUsed}`,
					`Logs:         ${receipt.logs?.length ?? 0} events`,
					receipt.contractAddress
						? `Contract:     ${receipt.contractAddress}`
						: "",
				]
					.filter(Boolean)
					.join("\n"),
			};
		}

		// ── eSpace write ────────────────────────────────────────────────────────

		case "blockchain_espace_send_cfx": {
			const wallet = new EspaceWalletClient({
				rpcUrl: espaceRpc,
				chainId: espaceChainId,
				privateKey: resolveKey(a, "espace"),
			});
			const amountWei = parseUnits(a.amount as string, 18);
			const hash = await wallet.sendTransaction({
				to: a.to as string,
				value: amountWei,
			});
			const receipt = await wallet.waitForTransaction(hash);
			return {
				text: [
					`Sent:         ${a.amount} CFX`,
					`From:         ${wallet.address}`,
					`To:           ${a.to}`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Block:        #${receipt.blockNumber}`,
					`Gas Used:     ${receipt.gasUsed}`,
				].join("\n"),
			};
		}

		case "blockchain_espace_write_contract": {
			const wallet = new EspaceWalletClient({
				rpcUrl: espaceRpc,
				chainId: espaceChainId,
				privateKey: resolveKey(a, "espace"),
			});
			const abi = parseAbi(a.abi);
			const args = parseArgs(a.args);
			const value = a.value ? parseUnits(a.value as string, 18) : undefined;
			const hash = await wallet.writeContract(
				a.address as string,
				abi,
				a.functionName as string,
				args,
				value,
			);
			const receipt = await wallet.waitForTransaction(hash);
			return {
				text: [
					`Contract:     ${a.address}`,
					`Function:     ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Block:        #${receipt.blockNumber}`,
					`Gas Used:     ${receipt.gasUsed}`,
					`Logs:         ${receipt.logs?.length ?? 0} events`,
				].join("\n"),
			};
		}

		case "blockchain_espace_deploy_contract": {
			const wallet = new EspaceWalletClient({
				rpcUrl: espaceRpc,
				chainId: espaceChainId,
				privateKey: resolveKey(a, "espace"),
			});

			// Auto-compile from source if abi+bytecode not provided
			let abiRaw = a.abi;
			let bytecodeRaw = a.bytecode as string | undefined;
			const contractName =
				(a.contractName as string | undefined) ?? "Unknown Contract";

			if (a.source && (!abiRaw || !bytecodeRaw)) {
				const { compileForDeploy } = await import("./compiler.js");
				const compiled = compileForDeploy(a.source as string, contractName);
				abiRaw = JSON.stringify(compiled.abi);
				bytecodeRaw = compiled.bytecode;
			}

			if (!abiRaw || !bytecodeRaw) {
				return {
					text: "Error: provide either (abi + bytecode) or source for deployment.",
					isError: true,
				};
			}

			const abi = parseAbi(abiRaw);
			const constructorArgs = parseArgs(a.constructorArgs);
			const contractAddress = await wallet.deployContract(
				abi,
				bytecodeRaw,
				constructorArgs,
			);
			// Track in devkit contract registry with ABI for tree view + cfxdevkit_contract_call
			try {
				await saveContract({
					name: contractName,
					address: contractAddress,
					chain: "evm",
					deployer: wallet.address,
					constructorArgs,
					deployedAt: new Date().toISOString(),
					chainId: espaceChainId,
					abi:
						typeof abiRaw === "string"
							? ((): unknown[] | undefined => {
									try {
										return JSON.parse(abiRaw) as unknown[];
									} catch {
										return undefined;
									}
								})()
							: (abiRaw as unknown[]),
				});
			} catch {
				/* non-fatal */
			}
			return {
				text: [
					`✓ Contract deployed to eSpace and tracked in devkit contract registry`,
					`Name:         ${contractName}`,
					`Address:      ${contractAddress}`,
					`Deployer:     ${wallet.address}`,
					`Network:      eSpace (chainId ${espaceChainId})`,
					`RPC:          ${espaceRpc}`,
					``,
					`ABI stored — use cfxdevkit_contract_call / cfxdevkit_contract_write to interact.`,
					`Tree view will auto-refresh within 15 seconds.`,
				].join("\n"),
			};
		}

		// ── Core Space read ─────────────────────────────────────────────────────

		case "blockchain_core_get_balance": {
			const client = coreClient(coreRpc, coreChainId);
			const balance = await client.getBalance(
				a.address as Parameters<typeof client.getBalance>[0],
			);
			const epochNum = await client.getBlockNumber();
			return {
				text: [
					`Address:      ${a.address}`,
					`Balance:      ${balance} CFX`,
					`Epoch:        #${epochNum}`,
					`Network:      Core Space (chainId ${coreChainId})`,
					`RPC:          ${coreRpc}`,
				].join("\n"),
			};
		}

		case "blockchain_core_get_block_number": {
			const client = coreClient(coreRpc, coreChainId);
			const epochNum = await client.getBlockNumber();
			return {
				text: `Latest epoch: #${epochNum}\nNetwork: Core Space (chainId ${coreChainId})\nRPC: ${coreRpc}`,
			};
		}

		case "blockchain_core_get_chain_id": {
			const client = coreClient(coreRpc, coreChainId);
			const chainId =
				(await (
					client.getInternalClient() as { getChainId?: () => Promise<number> }
				).getChainId?.()) ?? coreChainId;
			const known: Record<number, { name: string; prefix: string }> = {
				2029: { name: "local devkit", prefix: "net2029" },
				1: { name: "testnet", prefix: "cfxtest" },
				1029: { name: "mainnet", prefix: "cfx" },
			};
			const net = known[chainId as number] ?? {
				name: "custom",
				prefix: `net${chainId}`,
			};
			return {
				text: `Chain ID: ${chainId} (${net.name})\nCore address prefix: ${net.prefix}\nRPC: ${coreRpc}`,
			};
		}

		case "blockchain_core_call_contract": {
			const client = coreClient(coreRpc, coreChainId);
			const abi = parseAbi(a.abi);
			const args = parseArgs(a.args);
			const pub = client.getInternalClient() as {
				readContract: (opts: unknown) => Promise<unknown>;
			};
			const result = await pub.readContract({
				address: a.address as string,
				abi,
				functionName: a.functionName as string,
				args,
			});
			return {
				text: [
					`Contract:     ${a.address}`,
					`Function:     ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
					`Result:       ${stringify(result)}`,
				].join("\n"),
			};
		}

		case "blockchain_core_read_erc20": {
			const client = coreClient(coreRpc, coreChainId);
			const addr = a.tokenAddress as string;
			const pub = client.getInternalClient() as {
				readContract: (opts: unknown) => Promise<unknown>;
			};
			const [name, symbol, decimals, totalSupply] = await Promise.all([
				pub.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "name",
				}) as Promise<string>,
				pub.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "symbol",
				}) as Promise<string>,
				pub.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "decimals",
				}) as Promise<number>,
				pub.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "totalSupply",
				}) as Promise<bigint>,
			]);
			const lines = [
				`Token:        ${name} (${symbol})`,
				`Address:      ${addr}`,
				`Decimals:     ${decimals}`,
				`Total Supply: ${formatUnits(totalSupply, decimals)} ${symbol}`,
			];
			if (a.holderAddress) {
				const balance = (await pub.readContract({
					address: addr,
					abi: ERC20_ABI,
					functionName: "balanceOf",
					args: [a.holderAddress as string],
				})) as bigint;
				lines.push(`Holder:       ${a.holderAddress}`);
				lines.push(`Balance:      ${formatUnits(balance, decimals)} ${symbol}`);
				if (a.spenderAddress) {
					const allowance = (await pub.readContract({
						address: addr,
						abi: ERC20_ABI,
						functionName: "allowance",
						args: [a.holderAddress as string, a.spenderAddress as string],
					})) as bigint;
					lines.push(
						`Allowance:    ${formatUnits(allowance, decimals)} ${symbol} (for ${a.spenderAddress})`,
					);
				}
			}
			return { text: lines.join("\n") };
		}

		// ── Core Space write ────────────────────────────────────────────────────

		case "blockchain_core_send_cfx": {
			const wallet = new CoreWalletClient({
				rpcUrl: coreRpc,
				chainId: coreChainId,
				privateKey: resolveKey(a, "core"),
			});
			const hash = await wallet.faucet(a.to as string, a.amount as string);
			const receipt = await wallet.waitForTransaction(hash);
			return {
				text: [
					`Sent:         ${a.amount} CFX`,
					`From:         ${wallet.address}`,
					`To:           ${a.to}`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Epoch:        #${receipt.blockNumber}`,
					`Gas Used:     ${receipt.gasUsed}`,
				].join("\n"),
			};
		}

		case "blockchain_core_write_contract": {
			const wallet = new CoreWalletClient({
				rpcUrl: coreRpc,
				chainId: coreChainId,
				privateKey: resolveKey(a, "core"),
			});
			const abi = parseAbi(a.abi);
			const args = parseArgs(a.args);
			const value = a.value
				? BigInt(Math.floor(parseFloat(a.value as string) * 1e18))
				: undefined;
			const hash = await wallet.writeContract(
				a.address as string,
				abi,
				a.functionName as string,
				args,
				value,
			);
			const receipt = await wallet.waitForTransaction(hash);
			return {
				text: [
					`Contract:     ${a.address}`,
					`Function:     ${a.functionName as string}(${args.length ? stringify(args) : ""})`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Epoch:        #${receipt.blockNumber}`,
					`Gas Used:     ${receipt.gasUsed}`,
				].join("\n"),
			};
		}

		case "blockchain_core_erc20_transfer": {
			const client = coreClient(coreRpc, coreChainId);
			const wallet = new CoreWalletClient({
				rpcUrl: coreRpc,
				chainId: coreChainId,
				privateKey: resolveKey(a, "core"),
			});
			const addr = a.tokenAddress as string;
			const pub = client.getInternalClient() as {
				readContract: (opts: unknown) => Promise<unknown>;
			};
			const decimals = (await pub.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "decimals",
			})) as number;
			const symbol = (await pub.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "symbol",
			})) as string;
			const rawAmount = parseUnits(a.amount as string, decimals);
			const hash = await wallet.writeContract(
				addr,
				[...ERC20_ABI] as unknown[],
				"transfer",
				[a.to as string, rawAmount],
			);
			const receipt = await wallet.waitForTransaction(hash);
			return {
				text: [
					`Transferred:  ${a.amount} ${symbol}`,
					`From:         ${wallet.address}`,
					`To:           ${a.to}`,
					`Token:        ${addr}`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Epoch:        #${receipt.blockNumber}`,
				].join("\n"),
			};
		}

		case "blockchain_core_erc20_approve": {
			const client = coreClient(coreRpc, coreChainId);
			const wallet = new CoreWalletClient({
				rpcUrl: coreRpc,
				chainId: coreChainId,
				privateKey: resolveKey(a, "core"),
			});
			const addr = a.tokenAddress as string;
			const pub = client.getInternalClient() as {
				readContract: (opts: unknown) => Promise<unknown>;
			};
			const decimals = (await pub.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "decimals",
			})) as number;
			const symbol = (await pub.readContract({
				address: addr,
				abi: ERC20_ABI,
				functionName: "symbol",
			})) as string;
			const MAX_UINT256 = BigInt(
				"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
			);
			const rawAmount =
				(a.amount as string).toLowerCase() === "unlimited"
					? MAX_UINT256
					: parseUnits(a.amount as string, decimals);
			const hash = await wallet.writeContract(
				addr,
				[...ERC20_ABI] as unknown[],
				"approve",
				[a.spender as string, rawAmount],
			);
			const receipt = await wallet.waitForTransaction(hash);
			const displayAmount =
				rawAmount === MAX_UINT256 ? "unlimited" : `${a.amount} ${symbol}`;
			return {
				text: [
					`Approved:     ${displayAmount}`,
					`Owner:        ${wallet.address}`,
					`Spender:      ${a.spender}`,
					`Token:        ${addr}`,
					`Tx Hash:      ${hash}`,
					`Status:       ${receipt.status}`,
					`Epoch:        #${receipt.blockNumber}`,
				].join("\n"),
			};
		}

		case "blockchain_core_deploy_contract": {
			const wallet = new CoreWalletClient({
				rpcUrl: coreRpc,
				chainId: coreChainId,
				privateKey: resolveKey(a, "core"),
			});

			// Auto-compile from source if abi+bytecode not provided
			let abiRaw = a.abi;
			let bytecodeRaw = a.bytecode as string | undefined;
			const contractName =
				(a.contractName as string | undefined) ?? "Unknown Contract";

			if (a.source && (!abiRaw || !bytecodeRaw)) {
				const { compileForDeploy } = await import("./compiler.js");
				const compiled = compileForDeploy(a.source as string, contractName);
				abiRaw = JSON.stringify(compiled.abi);
				bytecodeRaw = compiled.bytecode;
			}

			if (!abiRaw || !bytecodeRaw) {
				return {
					text: "Error: provide either (abi + bytecode) or source for deployment.",
					isError: true,
				};
			}

			const abi = parseAbi(abiRaw);
			const constructorArgs = parseArgs(a.constructorArgs);
			const contractAddress = await wallet.deployContract(
				abi,
				bytecodeRaw,
				constructorArgs,
			);
			try {
				await saveContract({
					name: contractName,
					address: contractAddress,
					chain: "core",
					deployer: wallet.address,
					constructorArgs,
					deployedAt: new Date().toISOString(),
					chainId: coreChainId,
					abi:
						typeof abiRaw === "string"
							? ((): unknown[] | undefined => {
									try {
										return JSON.parse(abiRaw) as unknown[];
									} catch {
										return undefined;
									}
								})()
							: (abiRaw as unknown[]),
				});
			} catch {
				/* non-fatal */
			}
			return {
				text: [
					`✓ Contract deployed to Core Space and tracked in devkit contract registry`,
					`Name:         ${contractName}`,
					`Address:      ${contractAddress}`,
					`Deployer:     ${wallet.address}`,
					`Network:      Core Space (chainId ${coreChainId})`,
					`RPC:          ${coreRpc}`,
					``,
					`ABI stored — use cfxdevkit_contract_call / cfxdevkit_contract_write to interact.`,
					`Tree view will auto-refresh within 15 seconds.`,
				].join("\n"),
			};
		}

		// ── Wallet tools ────────────────────────────────────────────────────────

		case "blockchain_derive_accounts": {
			const mnemonic = a.mnemonic as string;
			const count = (a.count as number | undefined) ?? 5;
			const startIndex = (a.startIndex as number | undefined) ?? 0;
			const networkId =
				(a.coreNetworkId as number | undefined) ?? DEFAULT_CORE_CHAIN_ID;
			const includeFaucet = (a.includeFaucet as boolean | undefined) ?? true;

			const validation = validateMnemonic(mnemonic);
			if (!validation.valid) {
				return { text: `Invalid mnemonic: ${validation.error}`, isError: true };
			}

			const accounts = deriveAccounts(mnemonic, {
				count,
				startIndex,
				coreNetworkId: networkId,
			});

			const lines: string[] = [
				`Derived ${count} account(s) from mnemonic (network: ${networkId})`,
				"",
				"── Standard accounts ──",
			];
			for (const acc of accounts) {
				lines.push(`[${acc.index}] Core:          ${acc.coreAddress}`);
				lines.push(`     eSpace:        ${acc.evmAddress}`);
				lines.push(`     Core key:      ${acc.corePrivateKey}`);
				lines.push(`     eSpace key:    ${acc.evmPrivateKey}`);
				lines.push(`     Core path:     ${acc.paths.core}`);
				lines.push(`     eSpace path:   ${acc.paths.evm}`);
				lines.push("");
			}

			if (includeFaucet) {
				const faucet = deriveFaucetAccount(mnemonic, networkId);
				lines.push("── Faucet/Mining account (m/44'/503'/1'/0/0) ──");
				lines.push(`Core:          ${faucet.coreAddress}`);
				lines.push(`eSpace:        ${faucet.evmAddress}`);
				lines.push(`Core key:      ${faucet.corePrivateKey}`);
				lines.push(`eSpace key:    ${faucet.evmPrivateKey}`);
			}

			return { text: lines.join("\n") };
		}

		case "blockchain_validate_mnemonic": {
			const result = validateMnemonic(a.mnemonic as string);
			return {
				text: [
					`Valid:        ${result.valid}`,
					`Word count:   ${result.wordCount}`,
					result.error ? `Error:        ${result.error}` : "",
				]
					.filter(Boolean)
					.join("\n"),
			};
		}

		case "blockchain_generate_mnemonic": {
			const strength = (a.strength as 128 | 256 | undefined) ?? 128;
			const mnemonic = generateMnemonic(strength);
			const wordCount = strength === 128 ? 12 : 24;
			return {
				text: [
					`Generated ${wordCount}-word mnemonic:`,
					mnemonic,
					"",
					"NOTE: This is a NEW random mnemonic, not the devkit keystore mnemonic.",
					"To get private keys for devkit genesis accounts, use blockchain_derive_accounts",
					'with the mnemonic shown during "Conflux: Initialize Setup".',
				].join("\n"),
			};
		}

		case "blockchain_espace_sign_message": {
			const wallet = new EspaceWalletClient({
				rpcUrl: espaceRpc,
				chainId: espaceChainId,
				privateKey: a.privateKey as string,
			});
			const signature = await wallet.signMessage(a.message as string);
			return {
				text: [
					`Message:      ${a.message}`,
					`Signer:       ${wallet.address}`,
					`Signature:    ${signature}`,
				].join("\n"),
			};
		}

		default:
			return { text: `Unknown blockchain tool: ${name}`, isError: true };
	}
}
