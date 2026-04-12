#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));

const nextVersion = positional[0];
const shouldCommit = flags.has('--commit');
const shouldTag = flags.has('--tag');
const allowDirty = flags.has('--allow-dirty');
const dryRun = flags.has('--dry-run');

const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

const filesToBump = [
  'package.json',
  'package-lock.json',
  'packages/contracts/package.json',
  'packages/devkit-backend/package.json',
  'packages/mcp-server/package.json',
  'packages/shared/package.json',
  'packages/ui-shared/package.json',
  'packages/vscode-extension/package.json',
  'packages/workspace-cli/package.json',
  'scaffolds/project-example/ui-shared/package.json',
];

if (!nextVersion || !versionPattern.test(nextVersion)) {
  console.error('Usage: pnpm release:bump -- <version> [--commit] [--tag] [--allow-dirty] [--dry-run]');
  console.error('Example: pnpm release:bump -- 0.2.0 --commit --tag');
  process.exit(1);
}

if (shouldTag && !shouldCommit) {
  console.error('--tag requires --commit so the tag points at a release commit.');
  process.exit(1);
}

const currentVersion = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;
if (currentVersion === nextVersion) {
  console.error(`Version is already ${nextVersion}.`);
  process.exit(1);
}

if (!allowDirty) {
  const status = execGit(['status', '--porcelain']);
  if (status.trim()) {
    console.error('Working tree is not clean. Commit or stash changes first, or rerun with --allow-dirty.');
    process.exit(1);
  }
}

const changedFiles = [];

for (const relativePath of filesToBump) {
  const absolutePath = resolve(repoRoot, relativePath);
  const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  const fileCurrentVersion = relativePath === 'package-lock.json' ? parsed.packages?.['']?.version ?? parsed.version : parsed.version;
  if (fileCurrentVersion !== currentVersion) {
    continue;
  }

  parsed.version = nextVersion;
  if (relativePath === 'package-lock.json' && parsed.packages?.['']) {
    parsed.packages[''].version = nextVersion;
  }
  changedFiles.push(relativePath);

  if (!dryRun) {
    writeFileSync(absolutePath, `${JSON.stringify(parsed, null, 2)}\n`);
  }
}

if (!changedFiles.length) {
  console.error(`No files were updated from ${currentVersion}.`);
  process.exit(1);
}

console.log(`Bumped ${changedFiles.length} files from ${currentVersion} to ${nextVersion}:`);
for (const relativePath of changedFiles) {
  console.log(`- ${relativePath}`);
}

if (dryRun) {
  process.exit(0);
}

if (shouldCommit) {
  execGit(['add', ...changedFiles]);
  execGit(['commit', '-m', `chore(release): v${nextVersion}`]);
  console.log(`Created commit chore(release): v${nextVersion}`);
}

if (shouldTag) {
  execGit(['tag', `v${nextVersion}`]);
  console.log(`Created tag v${nextVersion}`);
}

function execGit(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}