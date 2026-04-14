#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const outputDir = resolve(process.cwd(), 'generated');
mkdirSync(outputDir, { recursive: true });

const artifact = `export const exampleCounterArtifact = ${JSON.stringify({
  contractName: 'ExampleCounter',
  chainId: 2030,
  address: null,
  abi: [
    {
      type: 'function',
      name: 'increment',
      stateMutability: 'nonpayable',
      inputs: [],
      outputs: []
    },
    {
      type: 'function',
      name: 'current',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ name: '', type: 'uint256' }]
    }
  ]
}, null, 2)};\n`;

writeFileSync(resolve(outputDir, 'example-counter.js'), artifact);
console.log('Wrote contracts/generated/example-counter.js');
