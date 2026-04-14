#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

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
  restoreReleaseFiles();
  console.log(`Dry run completed for ${nextVersion}. Version files were restored and nothing was committed, published, or pushed.`);
  process.exit(0);
}

await ensureNpmAuth({
  cwd: resolve(repoRoot, 'packages/workspace-cli'),
});
runStep('Publish conflux-workspace to npm', ['npm', 'publish', '--access', 'public'], {
  cwd: resolve(repoRoot, 'packages/workspace-cli'),
  restoreOnFailure: true,
});

runStep('Create release commit', ['git', 'add', ...releaseFiles]);
runStep('Commit version bump', ['git', 'commit', '-m', `chore(release): v${nextVersion}`]);
runStep('Create release tag', ['git', 'tag', targetTag]);
runStep('Push main branch', ['git', 'push', remote, branch]);
runStep('Push release tag', ['git', 'push', remote, targetTag]);

console.log(`Release ${nextVersion} published to npm and pushed to ${remote}.`);
console.log(`GitHub Actions will now publish ghcr.io/cfxdevkit/devkit-workspace-web:${nextVersion}.`);

async function ensureNpmAuth(options = {}) {
  if (hasNpmAuth(options)) {
    console.log('npm authentication confirmed.');
    return;
  }

  console.log('npm authentication is required before publishing conflux-workspace.');
  console.log('This is a user action and can be completed with npm login.');

  if (process.env.CI || !process.stdin.isTTY || !process.stdout.isTTY) {
    restoreReleaseFiles();
    console.error('Interactive npm authentication is not available in this terminal. Run npm login or configure NPM_TOKEN, then rerun the release command.');
    process.exit(1);
  }

  const shouldLogin = await promptYesNo('Run npm login now? [Y/n] ');
  if (!shouldLogin) {
    restoreReleaseFiles();
    console.error('Release cancelled before publish. Authenticate with npm and rerun the release command when ready.');
    process.exit(1);
  }

  runStep('Authenticate with npm', ['npm', 'login'], {
    cwd: options.cwd ?? repoRoot,
    restoreOnFailure: true,
  });

  if (!hasNpmAuth(options)) {
    restoreReleaseFiles();
    console.error('npm authentication is still unavailable after npm login. Run npm whoami to confirm your session, then retry the release.');
    process.exit(1);
  }

  console.log('npm authentication confirmed.');
}

function hasNpmAuth(options = {}) {
  const result = spawnSync('npm', ['whoami'], {
    cwd: options.cwd ?? repoRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    return false;
  }

  return (result.status ?? 1) === 0;
}

async function promptYesNo(question) {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(question)).trim().toLowerCase();
    return !answer || answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

function restoreReleaseFiles() {
  for (const [relativePath, content] of originalReleaseFileContents) {
    writeFileSync(resolve(repoRoot, relativePath), content);
  }
}

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
    if (options.restoreOnFailure) {
      restoreReleaseFiles();
    }
    console.error(result.error.message);
    process.exit(1);
  }

  const status = result.status ?? 0;
  if (status !== 0) {
    if (options.restoreOnFailure) {
      restoreReleaseFiles();
    }
    process.exit(status);
  }
}