#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const targetArg = process.argv[2];
if (!targetArg) {
  console.error('Usage: node scripts/install-project-deps.mjs <project-dir>');
  process.exit(1);
}

const projectDir = resolve(process.cwd(), targetArg);
const lockfilePath = resolve(projectDir, 'pnpm-lock.yaml');
const args = existsSync(lockfilePath)
  ? ['install', '--frozen-lockfile']
  : ['install', '--no-frozen-lockfile'];

execFileSync('pnpm', args, {
  cwd: projectDir,
  stdio: 'inherit',
});
