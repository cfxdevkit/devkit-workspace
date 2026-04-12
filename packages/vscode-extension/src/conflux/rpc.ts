/**
 * rpc.ts — JSON-RPC helpers for contract read/write.
 *
 * Handles contract interaction (read/write) by:
 *   READ:  eth_call / cfx_call JSON-RPC using ABI encoding from utils/abi.ts
 *   WRITE: routes through conflux-devkit REST API /api/contracts/write
 *          (uses keystore for signing — no private key in extension)
 *
 * ABI encoding, keccak256, and result decoding live in utils/abi.ts.
 */

import * as vscode from 'vscode';
import { resolveMcpDist } from '../utils/fs';
import { encodeCalldata, decodeResult, bytesToHex, type AbiFunction } from '../utils/abi';

export type { AbiInput, AbiFunction } from '../utils/abi';

// ── Config ───────────────────────────────────────────────────────────────────

function _getDevkitPort(): number {
  return vscode.workspace.getConfiguration('cfxdevkit').get<number>('port') ?? 7748;
}

// ── Public API ────────────────────────────────────────────────────────────────

let _rpcId = 1;

async function jsonRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: _rpcId++, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json() as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result as T;
}

/**
 * Call a read-only contract function via direct JSON-RPC (eth_call / cfx_call).
 * Returns a human-readable result string.
 */
export async function callContractRead(
  address: string,
  chain: 'evm' | 'core',
  fn: AbiFunction,
  args: unknown[]
): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('cfxdevkit');
  const espaceRpc = cfg.get<string>('espaceRpc') ?? 'http://127.0.0.1:8545';
  const coreRpc = cfg.get<string>('coreRpc') ?? 'http://127.0.0.1:12537';
  const rpcUrl = chain === 'evm' ? espaceRpc : coreRpc;

  const calldata = encodeCalldata(fn, args);
  if (!calldata) {
    throw new Error(
      `Cannot encode args for "${fn.name}". ` +
      `Use the MCP tool: cfxdevkit_contract_call nameOrAddress="${address}" functionName="${fn.name}"`
    );
  }

  const method = chain === 'evm' ? 'eth_call' : 'cfx_call';
  const params = chain === 'evm'
    ? [{ to: address, data: bytesToHex(calldata) }, 'latest']
    : [{ to: address, data: bytesToHex(calldata) }, 'latest_state'];

  const result = await jsonRpc<string>(rpcUrl, method, params);
  return decodeResult(fn.outputs, result);
}

/**
 * Call a write (state-changing) contract function via the MCP server's
 * blockchain tool handler.  Spawns a short-lived Node.js process that
 * imports the handler, signs locally with the keystore, and broadcasts
 * the raw transaction to the eSpace/Core RPC node.
 */
export async function writeContractViaApi(
  address: string,
  chain: 'evm' | 'core',
  fn: AbiFunction,
  args: unknown[],
  accountIndex: number
): Promise<{ txHash: string; status: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  const toolName = chain === 'evm'
    ? 'blockchain_espace_write_contract'
    : 'blockchain_core_write_contract';

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceFolder) throw new Error('No workspace folder found');

  const blockchainPath = await resolveMcpDist('blockchain', workspaceFolder);

  // Build the inline script that calls the MCP blockchain handler
  const script = `
    const{blockchainToolHandler:h}=await import(${JSON.stringify(blockchainPath)});
    const r=await h('${toolName}',{
      address:${JSON.stringify(address)},
      abi:${JSON.stringify(JSON.stringify([fn]))},
      functionName:${JSON.stringify(fn.name)},
      args:${JSON.stringify(args)},
      accountIndex:${accountIndex}
    });
    process.stdout.write(JSON.stringify({text:r.text,isError:r.isError||false}));
  `;

  try {
    const { stdout } = await execFileAsync(
      'node',
      ['--input-type=module', '-e', script],
      { cwd: workspaceFolder, timeout: 60_000 }
    );
    const result = JSON.parse(stdout) as { text: string; isError: boolean };
    if (result.isError) {
      throw new Error(result.text);
    }
    // Extract tx hash from the MCP tool output
    const hashMatch = result.text.match(/Tx Hash:\s+(0x[0-9a-fA-F]+)/);
    const statusMatch = result.text.match(/Status:\s+(\w+)/);
    return {
      txHash: hashMatch?.[1] ?? result.text,
      status: statusMatch?.[1] ?? 'success',
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Write failed: ${msg}`);
  }
}
