#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validator = resolve(repoRoot, 'scripts', 'validate-package-format.mjs');

try {
  execFileSync(process.execPath, [validator, '--strict'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
} catch {
  process.exit(1);
}
