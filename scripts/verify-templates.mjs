#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');
const cliPath = resolve(repoRoot, 'packages', 'scaffold-cli', 'src', 'cli.js');
const generatedRoot = resolve(repoRoot, '.generated', 'verify-templates');

function run(command, args, cwd = repoRoot) {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function verifyManifest(projectRoot, expectedTemplate, expectedTarget) {
  const manifestPath = resolve(projectRoot, '.new-devkit', 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing generation manifest: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  if (manifest.template !== expectedTemplate) {
    throw new Error(`Expected template ${expectedTemplate} but found ${manifest.template}`);
  }
  if (manifest.target !== expectedTarget) {
    throw new Error(`Expected target ${expectedTarget} but found ${manifest.target}`);
  }
}

function verifyMinimal(projectRoot, expectedTarget) {
  verifyManifest(projectRoot, 'minimal-dapp', expectedTarget);
  run(process.execPath, ['--check', resolve(projectRoot, 'scripts', 'dev.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'src', 'main.js')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'ui-shared', 'src', 'devkit.js')]);
}

function verifyProjectExample(projectRoot, expectedTarget) {
  verifyManifest(projectRoot, 'project-example', expectedTarget);
  run(process.execPath, ['--check', resolve(projectRoot, 'scripts', 'lib', 'operations.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'scripts', 'doctor.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'scripts', 'sync-project-network.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'scripts', 'write-contract-artifact.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'scripts', 'list-contracts.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'contracts', 'scripts', 'compile.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'dapp', 'scripts', 'dev.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'dapp', 'scripts', 'build.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'dapp', 'scripts', 'serve.mjs')]);
  run(process.execPath, ['--check', resolve(projectRoot, 'dapp', 'src', 'main.js')]);
  run('pnpm', ['smoke:workspace'], projectRoot);
}

function createScaffold(destinationPath, template, target) {
  const args = [cliPath, 'create', destinationPath, '--template', template];
  if (target) {
    args.push('--target', target);
  }
  run(process.execPath, args, repoRoot);
}

rmSync(generatedRoot, { recursive: true, force: true });

const minimalDefault = resolve(generatedRoot, 'minimal-default');
const minimalCodeServer = resolve(generatedRoot, 'minimal-code-server');
const projectExampleDefault = resolve(generatedRoot, 'project-example-default');
const projectExampleCodeServer = resolve(generatedRoot, 'project-example-code-server');

createScaffold(minimalDefault, 'minimal-dapp', null);
createScaffold(minimalCodeServer, 'minimal-dapp', 'code-server');
createScaffold(projectExampleDefault, 'project-example', null);
createScaffold(projectExampleCodeServer, 'project-example', 'code-server');

verifyMinimal(minimalDefault, 'devcontainer');
verifyMinimal(minimalCodeServer, 'code-server');
verifyProjectExample(projectExampleDefault, 'devcontainer');
verifyProjectExample(projectExampleCodeServer, 'code-server');

console.log('Template verification completed successfully.');
