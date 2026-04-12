#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  ['Governance validation', ['run', 'validate']],
  ['Workspace package build', ['run', 'build:all']],
  ['Core tests', ['run', 'test:all']],
  ['Scaffold parity', ['run', 'scaffold:verify']],
  ['Template generation validation', ['run', 'validate:template']],
];

for (const [label, args] of steps) {
  const start = Date.now();
  console.log(`\n[audit] ${label}`);
  try {
    execFileSync('pnpm', args, { cwd: repoRoot, stdio: 'inherit' });
  } catch {
    console.error(`[audit] failed: ${label}`);
    process.exit(1);
  }
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[audit] completed: ${label} (${seconds}s)`);
}

console.log('\n[audit] full build audit passed.');
