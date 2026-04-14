#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assembleProjectExample } from './assemble-project-example.mjs';

const DEFAULT_COMMIT_MESSAGE = 'Initial commit from CFX DevKit project-example scaffold';

function printHelp() {
  console.log(`Usage: node scripts/create-project-example-repo.mjs <repo> [options]

Create a new repository from the project-example scaffold, initialize git,
and optionally create/push a GitHub repository via gh.

Arguments:
  <repo>                  Repository name or owner/name

Options:
  --owner <owner>         GitHub owner when <repo> is only a repo name
  --dir <path>            Local destination directory (default: ./<repo-name>)
  --public                Create a public GitHub repository
  --private               Create a private GitHub repository (default)
  --description <text>    Repository description passed to gh repo create
  --homepage <url>        Homepage URL passed to gh repo create
  --remote <name>         Git remote name (default: origin)
  --skip-gh               Create the local repo but skip gh repo create/push
  --help                  Show this help text

Examples:
  pnpm run project-example:create-repo -- my-project
  pnpm run project-example:create-repo -- cfxdevkit/my-project --public
  pnpm run project-example:create-repo -- my-project --owner cfxdevkit --dir ./output/my-project
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    repo: null,
    owner: null,
    dir: null,
    visibility: 'private',
    description: null,
    homepage: null,
    remote: 'origin',
    skipGh: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--help':
        printHelp();
        process.exit(0);
        break;
      case '--owner':
        options.owner = takeValue(argv, ++index, '--owner');
        break;
      case '--dir':
        options.dir = takeValue(argv, ++index, '--dir');
        break;
      case '--public':
        options.visibility = 'public';
        break;
      case '--private':
        options.visibility = 'private';
        break;
      case '--description':
        options.description = takeValue(argv, ++index, '--description');
        break;
      case '--homepage':
        options.homepage = takeValue(argv, ++index, '--homepage');
        break;
      case '--remote':
        options.remote = takeValue(argv, ++index, '--remote');
        break;
      case '--skip-gh':
        options.skipGh = true;
        break;
      default:
        if (arg.startsWith('-')) {
          fail(`Unknown option: ${arg}`);
        }
        if (options.repo) {
          fail(`Unexpected extra argument: ${arg}`);
        }
        options.repo = arg;
    }
  }

  if (!options.repo) {
    printHelp();
    process.exit(1);
  }

  return options;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('-')) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

function run(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    fail(`${command} exited with status ${result.status}`);
  }
}

function readCommandOutput(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    const stderr = result.stderr?.trim();
    fail(stderr || `${command} exited with status ${result.status}`);
  }

  return (result.stdout || '').trim();
}

function ensureCommand(command, versionArgs = ['--version']) {
  const result = spawnSync(command, versionArgs, {
    stdio: 'ignore',
  });

  if (result.error || result.status !== 0) {
    fail(`Required command not found or not usable: ${command}`);
  }
}

function ensureEmptyDestination(destination) {
  if (!existsSync(destination)) {
    mkdirSync(destination, { recursive: true });
    return;
  }

  if (readdirSync(destination).length > 0) {
    fail(`Destination already exists and is not empty: ${destination}`);
  }
}

function resolveRepoRef(repo, owner) {
  if (repo.includes('/')) {
    if (owner) {
      fail('Pass either an owner/name repo argument or --owner, not both.');
    }
    return repo;
  }

  return owner ? `${owner}/${repo}` : repo;
}

function ensureGitIdentity(cwd) {
  const userName = readCommandOutput('git', ['config', '--get', 'user.name'], { cwd });
  const userEmail = readCommandOutput('git', ['config', '--get', 'user.email'], { cwd });

  if (!userName || !userEmail) {
    fail('Git user.name and user.email must be configured before creating a repository.');
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRef = resolveRepoRef(options.repo, options.owner);
  const repoName = basename(repoRef);
  const destination = resolve(process.cwd(), options.dir ?? repoName);

  ensureCommand('git');
  if (!options.skipGh) {
    ensureCommand('gh');
  }

  ensureEmptyDestination(destination);

  console.log(`[devkit] Assembling scaffold into ${destination}`);
  assembleProjectExample({ destination, clean: false });

  ensureGitIdentity(destination);

  console.log('[devkit] Initializing git repository');
  run('git', ['init', '--initial-branch=main'], { cwd: destination });
  run('git', ['add', '--all'], { cwd: destination });
  run('git', ['commit', '-m', DEFAULT_COMMIT_MESSAGE], { cwd: destination });

  if (options.skipGh) {
    console.log('[devkit] Local repository created. Skipped gh repo create (--skip-gh).');
    console.log(`[devkit] Next: gh repo create ${repoRef} --${options.visibility} --source ${destination} --remote ${options.remote} --push`);
    return;
  }

  const ghArgs = ['repo', 'create', repoRef, `--${options.visibility}`, '--source', destination, '--remote', options.remote, '--push'];
  if (options.description) {
    ghArgs.push('--description', options.description);
  }
  if (options.homepage) {
    ghArgs.push('--homepage', options.homepage);
  }

  console.log(`[devkit] Creating GitHub repository ${repoRef}`);
  run('gh', ghArgs, { cwd: destination });

  console.log(`[devkit] Repository ready at ${destination}`);
  console.log(`[devkit] Open it in Codespaces or locally with Dev Containers. The scaffold now includes .devcontainer/ and installs dependencies on first create.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}