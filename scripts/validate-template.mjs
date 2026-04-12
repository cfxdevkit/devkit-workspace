#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = resolve(repoRoot, 'packages', 'workspace-cli', 'dist', 'cli.js');
const installDepsEntry = resolve(repoRoot, 'scripts', 'install-project-deps.mjs');

function run(command, args, cwd = repoRoot) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

const tempRoot = mkdtempSync(join(tmpdir(), 'cfx-template-validate-'));
const workspaceDir = join(tempRoot, 'project');

try {
  run(process.execPath, [cliEntry, 'create', workspaceDir]);
  run(process.execPath, [installDepsEntry, workspaceDir]);
  run('pnpm', ['build'], workspaceDir);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}