#!/usr/bin/env node
import { execSync } from 'node:child_process';

const steps = [
  { name: 'imports', cmd: 'pnpm run check:imports' },
  { name: 'packages', cmd: 'pnpm run check:packages' },
  { name: 'artifact-policy', cmd: 'pnpm run policy:artifacts' },
  { name: 'scaffold-template', cmd: 'pnpm run scaffold:verify:template' },
  { name: 'mcp-tests', cmd: 'pnpm --filter @cfxdevkit/mcp test' },
  { name: 'mcp-build', cmd: 'pnpm --filter @cfxdevkit/mcp build' },
  { name: 'shared-build', cmd: 'pnpm --filter @cfxdevkit/shared build' },
  { name: 'extension-test', cmd: 'pnpm --filter cfxdevkit-workspace-ext test' },
];

for (const step of steps) {
  console.log(`\n[verify-fast] ${step.name}`);
  execSync(step.cmd, { stdio: 'inherit' });
}

console.log('\nverify-fast completed successfully.');
