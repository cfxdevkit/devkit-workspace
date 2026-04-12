#!/usr/bin/env node

const DEVKIT_URL = process.env.DEVKIT_URL ?? 'http://127.0.0.1:7748';

async function main() {
  const response = await fetch(`${DEVKIT_URL}/api/contracts/deployed`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`DevKit returned HTTP ${response.status}`);
  }

  const contracts = await response.json();
  if (!Array.isArray(contracts) || contracts.length === 0) {
    console.log('No contracts deployed yet.');
    return;
  }

  for (const contract of contracts) {
    console.log(`${contract.name}  ${contract.address}  ${contract.chain}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});