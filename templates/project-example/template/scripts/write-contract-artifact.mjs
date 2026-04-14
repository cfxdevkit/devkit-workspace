#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exampleCounterArtifact } from '../contracts/generated/example-counter.js';
import { parseOperationFlags, runOperation } from './lib/operations.mjs';

const flags = parseOperationFlags();

await runOperation('write-contract-artifact', flags, async ({ step }) => {
  const outputDir = resolve(process.cwd(), 'dapp', 'src', 'generated');
  const outputPath = resolve(outputDir, 'contracts-addresses.js');
  const chainId = Number(exampleCounterArtifact.chainId) || 2030;
  const trackedAddress = exampleCounterArtifact.address ?? null;
  const catalog = [
    {
      contractName: exampleCounterArtifact.contractName,
      chainId,
      trackedAddress,
      abiEntries: Array.isArray(exampleCounterArtifact.abi) ? exampleCounterArtifact.abi.length : 0,
    },
  ];

  step('load-contract-artifact', {
    status: 'completed',
    contractName: exampleCounterArtifact.contractName,
    chainId,
  });

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(
    outputPath,
    `export const CONTRACT_ADDRESSES_BY_CHAIN_ID = ${JSON.stringify({
      [chainId]: { [exampleCounterArtifact.contractName]: trackedAddress },
    }, null, 2)};\nexport const CONTRACT_CATALOG = ${JSON.stringify(catalog, null, 2)};\n`,
    'utf8',
  );

  step('write-contract-catalog', { status: 'completed', outputPath: 'dapp/src/generated/contracts-addresses.js' });
  return {
    contractName: exampleCounterArtifact.contractName,
    chainId,
    trackedAddress,
    outputPath: 'dapp/src/generated/contracts-addresses.js',
    message: 'Wrote dapp/src/generated/contracts-addresses.js',
  };
});
