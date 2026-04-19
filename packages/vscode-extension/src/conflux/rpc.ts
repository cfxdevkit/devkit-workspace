/**
 * rpc.ts — JSON-RPC helpers for contract read/write.
 *
 * Handles contract interaction (read/write) by:
 *   READ:  eth_call / cfx_call JSON-RPC using ABI encoding from utils/abi.ts
 *   WRITE: routes through devkit REST API /api/contracts/:id/call
 *          (uses keystore for signing — no private key in extension)
 *
 * ABI encoding, keccak256, and result decoding live in utils/abi.ts.
 */

import * as vscode from "vscode";
import {
	type AbiFunction,
	bytesToHex,
	decodeResult,
	encodeCalldata,
} from "../utils/abi";
import { callDeployedContract, getDeployedContracts } from "./api";

export type { AbiFunction, AbiInput } from "../utils/abi";

// ── Config ───────────────────────────────────────────────────────────────────

function _getDevkitPort(): number {
	return (
		vscode.workspace.getConfiguration("cfxdevkit").get<number>("port") ?? 7748
	);
}

// ── Public API ────────────────────────────────────────────────────────────────

let _rpcId = 1;

async function jsonRpc<T>(
	url: string,
	method: string,
	params: unknown[],
): Promise<T> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id: _rpcId++, method, params }),
		signal: AbortSignal.timeout(20_000),
	});
	const json = (await res.json()) as {
		result?: T;
		error?: { message: string };
	};
	if (json.error) throw new Error(json.error.message);
	return json.result as T;
}

/**
 * Call a read-only contract function via direct JSON-RPC (eth_call / cfx_call).
 * Returns a human-readable result string.
 */
export async function callContractRead(
	address: string,
	chain: "evm" | "core",
	fn: AbiFunction,
	args: unknown[],
): Promise<string> {
	const cfg = vscode.workspace.getConfiguration("cfxdevkit");
	const espaceRpc = cfg.get<string>("espaceRpc") ?? "http://127.0.0.1:8545";
	const coreRpc = cfg.get<string>("coreRpc") ?? "http://127.0.0.1:12537";
	const rpcUrl = chain === "evm" ? espaceRpc : coreRpc;

	const calldata = encodeCalldata(fn, args);
	if (!calldata) {
		throw new Error(
			`Cannot encode args for "${fn.name}". ` +
				`Use the MCP tool: cfxdevkit_contract_call nameOrAddress="${address}" functionName="${fn.name}"`,
		);
	}

	const method = chain === "evm" ? "eth_call" : "cfx_call";
	const params =
		chain === "evm"
			? [{ to: address, data: bytesToHex(calldata) }, "latest"]
			: [{ to: address, data: bytesToHex(calldata) }, "latest_state"];

	const result = await jsonRpc<string>(rpcUrl, method, params);
	return decodeResult(fn.outputs, result);
}

/**
 * Call a write (state-changing) contract function via the devkit REST API.
 * Looks up the deployed contract by address, then routes through
 * POST /api/contracts/:id/call which signs with the keystore on the backend.
 */
export async function writeContractViaApi(
	address: string,
	_chain: "evm" | "core",
	fn: AbiFunction,
	args: unknown[],
	accountIndex: number,
): Promise<{ txHash: string; status: string }> {
	// Resolve contract ID by address from deployed contracts registry
	const deployed = await getDeployedContracts();
	const contract = deployed.find(
		(c) => c.address.toLowerCase() === address.toLowerCase(),
	);
	if (!contract) {
		throw new Error(
			`Contract at ${address} not found in deployed contracts registry. ` +
				`Deploy or register it first.`,
		);
	}

	const result = await callDeployedContract(
		contract.id,
		fn.name,
		args,
		accountIndex,
	);
	return {
		txHash: result.txHash ?? "",
		status: result.status ?? "success",
	};
}
