#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEVKIT_URL = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748';
const TRACKING_PATH = resolve(__dirname, '..', 'deployments', 'contracts.json');
const OUTPUT_PATH = resolve(__dirname, '..', 'dapp', 'src', 'generated', 'project-network.ts');
const SUPPORTED_CHAIN_IDS = new Set([2030, 71, 1030]);

function chainIdFromNetworkName(value) {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'local') return 2030;
  if (normalized === 'testnet') return 71;
  if (normalized === 'mainnet') return 1030;
  return null;
}

function getPrimaryTrackedChainId() {
  if (!existsSync(TRACKING_PATH)) return null;

  try {
    const parsed = JSON.parse(readFileSync(TRACKING_PATH, 'utf8'));
    const networks = parsed?.networks;
    if (!networks || typeof networks !== 'object') return null;

    const chainIds = Object.values(networks)
      .map((entry) => Number(entry?.chainId))
      .filter((chainId) => SUPPORTED_CHAIN_IDS.has(chainId));

    if (chainIds.length === 0) return null;
    return chainIds.find((chainId) => chainId !== 2030) ?? chainIds[0] ?? null;
  } catch {
    return null;
  }
}

async function getDevkitChainId() {
  try {
    const response = await fetch(`${DEVKIT_URL}/api/network/current`, {
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const chainId = Number(payload?.evmChainId);
    return SUPPORTED_CHAIN_IDS.has(chainId) ? chainId : null;
  } catch {
    return null;
  }
}

function buildArtifact(chainId, source) {
  return `export const PROJECT_DEFAULT_CHAIN_ID = ${chainId};\nexport const PROJECT_DEFAULT_CHAIN_SOURCE = ${JSON.stringify(source)};\n`;
}

async function main() {
  const explicitChainId = Number(process.env.PROJECT_CHAIN_ID ?? process.env.DEPLOY_CHAIN_ID ?? '');
  const envNetworkChainId = chainIdFromNetworkName(process.env.DEVKIT_NETWORK ?? process.env.DEPLOY_NETWORK);

  const selected = Number.isFinite(explicitChainId) && SUPPORTED_CHAIN_IDS.has(explicitChainId)
    ? { chainId: explicitChainId, source: 'env-chain-id' }
    : envNetworkChainId
      ? { chainId: envNetworkChainId, source: 'env-network' }
      : null;

  const devkitChainId = selected ? null : await getDevkitChainId();
  const trackedChainId = selected || devkitChainId ? null : getPrimaryTrackedChainId();

  const resolved = selected
    ?? (devkitChainId ? { chainId: devkitChainId, source: 'devkit-current' } : null)
    ?? (trackedChainId ? { chainId: trackedChainId, source: 'deployments-tracking' } : null)
    ?? { chainId: 2030, source: 'default-local' };

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, buildArtifact(resolved.chainId, resolved.source), 'utf8');
  console.log(`Selected project chain ${resolved.chainId} (${resolved.source}).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});