#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const releaseFiles = [
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

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));

const nextVersion = positional[0];
const dryRun = flags.has('--dry-run');
const allowDirty = flags.has('--allow-dirty');
const remote = readFlagValue(args, '--remote') ?? 'origin';
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const originalReleaseFileContents = new Map(
  releaseFiles.map((relativePath) => [relativePath, readFileSync(resolve(repoRoot, relativePath), 'utf8')]),
);

if (!nextVersion || !versionPattern.test(nextVersion)) {
  console.error('Usage: pnpm release -- <version> [--dry-run] [--allow-dirty] [--remote origin]');
  console.error('Example: pnpm release -- 0.1.3');
  process.exit(1);
}

const branch = git(['branch', '--show-current']).trim();
if (branch !== 'main') {
  console.error(`Release must run from main. Current branch: ${branch || '(detached HEAD)'}`);
  process.exit(1);
}

if (!allowDirty) {
  const status = git(['status', '--porcelain']).trim();
  if (status) {
    console.error('Working tree is not clean. Commit or stash changes first, or rerun with --allow-dirty.');
    process.exit(1);
  }
}

const currentVersion = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')).version;
if (currentVersion === nextVersion) {
  console.error(`Version is already ${nextVersion}.`);
  process.exit(1);
}

const targetTag = `v${nextVersion}`;
if (git(['tag', '--list', targetTag]).trim()) {
  console.error(`Tag ${targetTag} already exists locally.`);
  process.exit(1);
}

if (git(['ls-remote', '--tags', remote, targetTag]).trim()) {
  console.error(`Tag ${targetTag} already exists on ${remote}.`);
  process.exit(1);
}

runStep(
  'Bump aligned package versions',
  ['pnpm', 'release:bump', '--', nextVersion, ...(allowDirty ? ['--allow-dirty'] : [])],
);
runStep('Run release preflight checks', ['pnpm', 'run', 'release:check']);
runStep('Build publishable CLI package', ['pnpm', '--filter', 'conflux-workspace', 'build']);

if (dryRun) {
  runStep('Preview npm package contents', ['npm', 'pack', '--dry-run'], {
    cwd: resolve(repoRoot, 'packages/workspace-cli'),
  });
  for (const [relativePath, content] of originalReleaseFileContents) {
    writeFileSync(resolve(repoRoot, relativePath), content);
  }
  console.log(`Dry run completed for ${nextVersion}. Version files were restored and nothing was committed, published, or pushed.`);
  process.exit(0);
}

runStep('Verify local npm auth', ['npm', 'whoami'], {
  cwd: resolve(repoRoot, 'packages/workspace-cli'),
});
runStep('Publish conflux-workspace to npm', ['npm', 'publish', '--access', 'public'], {
  cwd: resolve(repoRoot, 'packages/workspace-cli'),
});

runStep('Create release commit', ['git', 'add', ...releaseFiles]);
runStep('Commit version bump', ['git', 'commit', '-m', `chore(release): v${nextVersion}`]);
runStep('Create release tag', ['git', 'tag', targetTag]);
runStep('Push main branch', ['git', 'push', remote, branch]);
runStep('Push release tag', ['git', 'push', remote, targetTag]);

console.log(`Release ${nextVersion} published to npm and pushed to ${remote}.`);
console.log(`GitHub Actions will now publish ghcr.io/cfxdevkit/devkit-workspace-web:${nextVersion}.`);

function readFlagValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index === argv.length - 1) {
    return null;
  }
  return argv[index + 1];
}

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function runStep(label, command, options = {}) {
  console.log(`==> ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  const status = result.status ?? 0;
  if (status !== 0) {
    process.exit(status);
  }
}