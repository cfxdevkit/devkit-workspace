#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractsDir = resolve(__dirname, '..');

const require = createRequire(import.meta.url);
const solc = require('solc');

const sourcePath = resolve(contractsDir, 'Counter.sol');
const generatedDir = resolve(contractsDir, 'generated');
const artifactJsonPath = resolve(generatedDir, 'ExampleCounter.json');
const artifactTsPath = resolve(generatedDir, 'artifacts.ts');
const barrelPath = resolve(generatedDir, 'index.ts');

const source = readFileSync(sourcePath, 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'Counter.sol': { content: source } },
  settings: {
    optimizer: { enabled: false, runs: 200 },
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = Array.isArray(output.errors)
  ? output.errors.filter((e) => e.severity === 'error')
  : [];

if (errors.length > 0) {
  console.error(errors.map((e) => e.formattedMessage ?? e.message).join('\n\n'));
  process.exit(1);
}

const contract = output.contracts?.['Counter.sol']?.ExampleCounter;
if (!contract?.abi || !contract?.evm?.bytecode?.object) {
  console.error('Failed to compile ExampleCounter');
  process.exit(1);
}

const artifact = {
  contractName: 'ExampleCounter',
  sourceName: 'Counter.sol',
  abi: contract.abi,
  bytecode: `0x${contract.evm.bytecode.object}`,
};

mkdirSync(generatedDir, { recursive: true });

writeFileSync(artifactJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);

const artifactTs = `export const exampleCounterArtifact = ${JSON.stringify(artifact, null, 2)} as const;

export const exampleCounterAbi = exampleCounterArtifact.abi;
export const exampleCounterBytecode = exampleCounterArtifact.bytecode;
`;
writeFileSync(artifactTsPath, artifactTs);

const barrelTs = `export * from './artifacts';
`;
writeFileSync(barrelPath, barrelTs);

console.log('Generated contract artifacts in contracts/generated/');
