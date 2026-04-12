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
const action = args[0] ?? 'install';

function sanitizedEnv() {
  const env = { ...process.env };

  for (const key of Object.keys(env)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.startsWith('npm_config_') || lowerKey.startsWith('npm_package_') || lowerKey.startsWith('npm_lifecycle_')) {
      delete env[key];
    }
  }

  return env;
}

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

function runDoctor(options = {}) {
  return runStep(process.execPath, ['packages/workspace-cli/dist/cli.js', 'doctor'], options);
}

if (action !== 'install' && action !== 'uninstall') {
  console.error(`Unsupported action: ${action}`);
  process.exit(1);
}

if (action === 'install') {
  const buildStatus = runStep('pnpm', ['--silent', '--filter', 'conflux-workspace', 'build'], { inherit: verbose });
  if (buildStatus !== 0) {
    process.exit(buildStatus);
  }

  const doctorStatus = runDoctor({ inherit: verbose });
  if (doctorStatus !== 0) {
    console.error('Environment validation failed. Resolve the reported runtime issues before installing the CLI.');
    process.exit(doctorStatus);
  }
}

const npmArgs =
  action === 'install'
    ? ['install', '-g', '--prefix', `${process.env.HOME}/.local`, './packages/workspace-cli', '--loglevel=error']
    : ['uninstall', '-g', '--prefix', `${process.env.HOME}/.local`, 'conflux-workspace', '--loglevel=error'];

const status = runStep('npm', npmArgs, { inherit: verbose, env: sanitizedEnv() });
if (status !== 0) {
  process.exit(status);
}

if (action === 'install') {
  console.log('Installed conflux-workspace in ~/.local/bin');
  console.log('Ensure ~/.local/bin is on your PATH before invoking conflux-workspace directly.');
} else {
  console.log('Removed conflux-workspace from ~/.local/bin');
}