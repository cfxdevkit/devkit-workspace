#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

const rawArgs = process.argv.slice(2);
const verbose = rawArgs.includes('--verbose');
const args = rawArgs.filter((arg) => arg !== '--verbose');

function runStep(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: options.inherit ? undefined : 'utf8',
    env: options.env ?? process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  const status = result.status ?? 0;
  if (!options.inherit && status !== 0) {
    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();
    if (stdout) {
      console.error(stdout);
    }
    if (stderr) {
      console.error(stderr);
    }
  }

  return status;
}

const buildStatus = runStep('pnpm', ['--silent', '--filter', 'conflux-workspace', 'build'], { inherit: verbose });
if (buildStatus !== 0) {
  process.exit(buildStatus);
}

const cliArgs = [
  'packages/workspace-cli/dist/cli.js',
  ...(verbose ? ['--verbose'] : []),
  ...args,
];

const cliStatus = runStep(process.execPath, cliArgs, { inherit: true });
process.exit(cliStatus);