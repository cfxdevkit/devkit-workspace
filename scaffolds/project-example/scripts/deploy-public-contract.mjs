#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  readTracking,
  upsertDeployment,
  writeFrontendArtifactFromTracking,
  writeTracking,
} from './deployment-registry.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONTRACT_NAME = process.env.DEPLOY_CONTRACT_NAME ?? 'ExampleCounter';
const CHAIN_ID = Number(process.env.DEPLOY_CHAIN_ID ?? '71');
const NETWORK = process.env.DEPLOY_NETWORK?.trim() || (CHAIN_ID === 71 ? 'testnet' : CHAIN_ID === 1030 ? 'mainnet' : `chain-${CHAIN_ID}`);
const RPC_URL = process.env.DEPLOY_RPC_URL?.trim();
const PRIVATE_KEY = process.env.DEPLOY_PRIVATE_KEY?.trim();
const ARTIFACT_JSON = resolve(__dirname, '..', 'contracts', 'generated', 'ExampleCounter.json');

const EXPLORER_BY_CHAIN_ID = {
  71: 'https://evmtestnet.confluxscan.io',
  1030: 'https://evm.confluxscan.io',
};

function requiredEnv(value, key) {
  if (!value) {
    throw new Error(`Missing ${key}. Example: ${key}=... pnpm run deploy:public`);
  }
  return value;
}

async function main() {
  if (!Number.isFinite(CHAIN_ID) || CHAIN_ID <= 0) {
    throw new Error(`Invalid DEPLOY_CHAIN_ID: ${CHAIN_ID}`);
  }

  const rpcUrl = requiredEnv(RPC_URL, 'DEPLOY_RPC_URL');
  const privateKey = requiredEnv(PRIVATE_KEY, 'DEPLOY_PRIVATE_KEY');
  const normalizedPk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

  const artifact = JSON.parse(readFileSync(ARTIFACT_JSON, 'utf8'));
  const abi = artifact?.abi;
  const bytecode = artifact?.bytecode;
  if (!Array.isArray(abi) || typeof bytecode !== 'string') {
    throw new Error(`Invalid artifact at ${ARTIFACT_JSON}. Run: pnpm --filter contracts compile`);
  }

  const account = privateKeyToAccount(normalizedPk);
  const chain = defineChain({
    id: CHAIN_ID,
    name: `Conflux ${NETWORK}`,
    nativeCurrency: { name: 'CFX', symbol: 'CFX', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });

  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  console.log(`Deploying ${CONTRACT_NAME} to ${NETWORK} (chainId ${CHAIN_ID})...`);
  const txHash = await wallet.deployContract({
    abi,
    bytecode: bytecode.startsWith('0x') ? bytecode : `0x${bytecode}`,
    args: [],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const contractAddress = receipt.contractAddress;
  if (!contractAddress) {
    throw new Error('Deployment receipt does not include contractAddress.');
  }

  const state = readTracking();
  upsertDeployment(state, {
    network: NETWORK,
    chainId: CHAIN_ID,
    contractName: CONTRACT_NAME,
    address: contractAddress,
    txHash,
    deployer: account.address,
    source: 'public-rpc',
  });

  writeTracking(state);
  writeFrontendArtifactFromTracking(state, 'scripts/deploy-public-contract.mjs');

  console.log(`Deployed ${CONTRACT_NAME} at ${contractAddress}`);
  console.log(`Transaction: ${txHash}`);

  const explorer = process.env.DEPLOY_EXPLORER_BASE?.trim() || EXPLORER_BY_CHAIN_ID[CHAIN_ID];
  if (explorer) {
    console.log(`Explorer tx: ${explorer}/tx/${txHash}`);
    console.log(`Explorer address: ${explorer}/address/${contractAddress}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
