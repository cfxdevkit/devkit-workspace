#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const repoRoot = resolve(__dirname, '..');
const defaultScaffoldSource = resolve(repoRoot, 'scaffolds', 'project-example');
const defaultDexPublicSource = resolve(repoRoot, 'dex-ui', 'public');
const excludedNames = new Set(['node_modules', 'dist', 'dist-server', 'generated', 'deploy', 'pnpm-lock.yaml']);
const dexPublicAssetNames = ['known-tokens.json', 'pool-import-presets.json', 'token-icon-overrides.json', 'token-icons'];

function copyDirectoryContents(sourcePath, destinationPath) {
  mkdirSync(destinationPath, { recursive: true });
  cpSync(sourcePath, destinationPath, {
    recursive: true,
    filter: (srcPath) => !excludedNames.has(srcPath.split('/').pop() ?? ''),
  });
}

function copyDexPublicAssets(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) return;
  mkdirSync(destinationPath, { recursive: true });
  for (const name of dexPublicAssetNames) {
    const sourceAsset = resolve(sourcePath, name);
    if (!existsSync(sourceAsset)) continue;
    cpSync(sourceAsset, resolve(destinationPath, name), { recursive: true });
  }
}

export function assembleProjectExample({
  destination,
  scaffoldSource = defaultScaffoldSource,
  dexPublicSource = defaultDexPublicSource,
  clean = true,
} = {}) {
  if (!destination) {
    throw new Error('assembleProjectExample requires a destination path.');
  }

  if (!existsSync(scaffoldSource)) {
    throw new Error(`Project scaffold source not found: ${scaffoldSource}`);
  }

  const scaffoldUiSharedSource = resolve(scaffoldSource, 'ui-shared');
  if (!existsSync(scaffoldUiSharedSource)) {
    throw new Error(`Scaffold UI source not found: ${scaffoldUiSharedSource}`);
  }

  if (clean) {
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
  } else {
    mkdirSync(destination, { recursive: true });
  }

  copyDirectoryContents(scaffoldSource, destination);
  copyDirectoryContents(scaffoldUiSharedSource, resolve(destination, 'ui-shared'));
  copyDexPublicAssets(dexPublicSource, resolve(destination, 'dapp', 'public'));
}

function main() {
  const args = process.argv.slice(2);
  const destinationArg = args.find((arg) => !arg.startsWith('--'));
  const clean = !args.includes('--no-clean');

  if (!destinationArg) {
    console.error('Usage: node scripts/assemble-project-example.mjs <destination> [--no-clean]');
    process.exit(1);
  }

  try {
    assembleProjectExample({ destination: resolve(process.cwd(), destinationArg), clean });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}