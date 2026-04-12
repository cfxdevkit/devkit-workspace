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

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readTracking,
  updateFromDeployedContracts,
  upsertDeployment,
  writeFrontendArtifactFromTracking,
  writeTracking,
} from './deployment-registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEVKIT_URL = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748';
const DEVKIT_NETWORK = (process.env.DEVKIT_NETWORK ?? process.env.DEPLOY_NETWORK ?? 'local').trim().toLowerCase();
const CONTRACT_NAME = process.env.DEPLOY_CONTRACT_NAME ?? 'ExampleCounter';
const SOURCE_PATH = resolve(__dirname, '..', 'contracts', 'Counter.sol');

const EXPLORER_BY_CHAIN_ID = {
  71: 'https://evmtestnet.confluxscan.io',
  1030: 'https://evm.confluxscan.io',
};

// ──────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ──────────────────────────────────────────────────────────────────────────────

async function fetchDevkit(path, init, timeout = 30_000) {
  const response = await fetch(`${DEVKIT_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    throw new Error(json?.error ?? text ?? `HTTP ${response.status}`);
  }
  return json;
}

function normalizeDeployedContract(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.address === 'string') return payload;
  if (payload.data?.address) return payload.data;
  if (payload.contract?.address) return payload.contract;
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Local deploy (via DevKit backend API)
// ──────────────────────────────────────────────────────────────────────────────

async function deployLocal() {
  console.log(`Deploying ${CONTRACT_NAME} via DevKit local node...`);

  let contracts = await fetchDevkit('/api/contracts/deployed').catch(() => []);
  const existing = Array.isArray(contracts)
    ? contracts.find((c) => c.name === CONTRACT_NAME)
    : null;

  if (!existing) {
    const source = readFileSync(SOURCE_PATH, 'utf8');
    const compiled = await fetchDevkit('/api/contracts/compile', {
      method: 'POST',
      body: JSON.stringify({ source, contractName: CONTRACT_NAME }),
    });

    const deployPayload = await fetchDevkit('/api/contracts/deploy', {
      method: 'POST',
      body: JSON.stringify({
        contractName: CONTRACT_NAME,
        abi: compiled.abi,
        bytecode: compiled.bytecode,
        args: [],
        chain: 'evm',
        accountIndex: 0,
      }),
    });

    const deployed = normalizeDeployedContract(deployPayload);
    if (!deployed) throw new Error('DevKit deploy response did not include a contract address');

    console.log(`Deployed ${deployed.name ?? CONTRACT_NAME} at ${deployed.address}`);
    contracts = await fetchDevkit('/api/contracts/deployed').catch(() => contracts);
  } else {
    console.log(`Already deployed: ${existing.name} at ${existing.address}`);
  }

  const state = readTracking();
  updateFromDeployedContracts(state, Array.isArray(contracts) ? contracts : [], 'devkit-local');
  writeTracking(state);
  writeFrontendArtifactFromTracking(state, 'scripts/deploy-contract.mjs');
  console.log('Updated deployment tracking and frontend contract artifact.');
}

// ──────────────────────────────────────────────────────────────────────────────
// Public deploy (testnet / mainnet via DevKit backend — keystore-aware)
// ──────────────────────────────────────────────────────────────────────────────

async function deployPublic() {
  const chainId = Number(process.env.DEPLOY_CHAIN_ID);
  const rpcUrl = process.env.DEPLOY_RPC_URL?.trim();
  const accountIndex = Number(process.env.DEPLOY_ACCOUNT_INDEX ?? '0');
  const privateKey = process.env.DEPLOY_PRIVATE_KEY?.trim() || undefined;
  const networkLabel = DEVKIT_NETWORK; // 'testnet' | 'mainnet'
  const coreRpcByNetwork = {
    testnet: 'https://test.confluxrpc.com',
    mainnet: 'https://main.confluxrpc.com',
  };

  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`DEPLOY_CHAIN_ID is missing or invalid: "${process.env.DEPLOY_CHAIN_ID}"`);
  }
  if (!rpcUrl) throw new Error('DEPLOY_RPC_URL is required for testnet/mainnet deploys');

  const coreRpcUrl = coreRpcByNetwork[networkLabel];
  if (!coreRpcUrl) {
    throw new Error(`Unsupported DEVKIT_NETWORK for public deploy: ${networkLabel}`);
  }

  console.log(`Syncing DevKit backend to ${networkLabel} (chainId ${chainId})...`);

  // 1. Set the backend network profile so it uses the correct public RPC
  await fetchDevkit('/api/network/current', {
    method: 'PUT',
    body: JSON.stringify({
      mode: 'public',
      public: {
        evmRpcUrl: rpcUrl,
        coreRpcUrl,
        chainId: networkLabel === 'testnet' ? 1 : 1029,
        evmChainId: chainId,
      },
    }),
  });

  // 2. Compile the contract
  console.log(`Compiling ${CONTRACT_NAME}...`);
  const source = readFileSync(SOURCE_PATH, 'utf8');
  const compiled = await fetchDevkit('/api/contracts/compile', {
    method: 'POST',
    body: JSON.stringify({ source, contractName: CONTRACT_NAME }),
  });

  // 3. Deploy via backend — uses DevKit keystore at accountIndex;
  //    DEPLOY_PRIVATE_KEY overrides the keystore if provided.
  console.log(
    `Deploying ${CONTRACT_NAME} to ${networkLabel} (chainId ${chainId}) ` +
    `via DevKit backend (accountIndex ${accountIndex}${privateKey ? ', key override' : ''})...`
  );
  const deployPayload = await fetchDevkit('/api/contracts/deploy', {
    method: 'POST',
    body: JSON.stringify({
      contractName: CONTRACT_NAME,
      abi: compiled.abi,
      bytecode: compiled.bytecode,
      args: [],
      chain: 'evm',
      accountIndex,
      ...(privateKey ? { privateKey } : {}),
    }),
  }, 120_000);

  const deployed = normalizeDeployedContract(deployPayload);
  if (!deployed) throw new Error('DevKit deploy response did not include a contract address');

  const contractAddress = deployed.address;
  const txHash = deployed.txHash ?? deployed.transactionHash ?? '';
  const deployer = deployed.deployer ?? '';

  const state = readTracking();
  upsertDeployment(state, {
    network: networkLabel,
    chainId,
    contractName: CONTRACT_NAME,
    address: contractAddress,
    txHash,
    deployer,
    source: 'devkit-public',
  });

  writeTracking(state);
  writeFrontendArtifactFromTracking(state, 'scripts/deploy-contract.mjs');

  console.log(`Deployed ${CONTRACT_NAME} at ${contractAddress}`);
  if (txHash) console.log(`Transaction: ${txHash}`);
  const explorer = process.env.DEPLOY_EXPLORER_BASE?.trim() || EXPLORER_BY_CHAIN_ID[chainId];
  if (explorer) console.log(`Explorer: ${explorer}/address/${contractAddress}`);
  console.log('Updated deployment tracking and frontend contract artifact.');
}

// ──────────────────────────────────────────────────────────────────────────────
// Entry
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  if (DEVKIT_NETWORK === 'local') {
    await deployLocal();
  } else if (DEVKIT_NETWORK === 'testnet' || DEVKIT_NETWORK === 'mainnet') {
    await deployPublic();
  } else {
    throw new Error(`Unknown DEVKIT_NETWORK value: "${DEVKIT_NETWORK}". Expected local | testnet | mainnet`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});