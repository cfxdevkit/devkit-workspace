/**
 * parser.ts — argument parsing and help output.
 */

import type { AliasAction, Command, Options } from './types.js';
import { ALIAS_ACTIONS, COMMANDS } from './types.js';
import { fail } from './util.js';

export function parseArgs(argv: string[], defaultImage: string): Options {
  const opts: Options = {
    command: 'start',
    projectPath: null,
    projectPathSpecified: false,
    profileSlug: null,
    name: 'cfxdevkit-workspace',
    runtime: null,
    socket: null,
    image: defaultImage,
    imageSpecified: false,
    localImage: false,
    verbose: false,
    aliasAction: null,
    aliasName: null,
  };

  let commandExplicit = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') continue;

    if (!commandExplicit && COMMANDS.has(arg)) {
      opts.command = arg as Command;
      commandExplicit = true;
      continue;
    }

    if (opts.command === 'alias' && !opts.aliasAction && !arg.startsWith('--')) {
      if (!ALIAS_ACTIONS.has(arg)) {
        fail(`Unknown alias action: ${arg}`);
      }
      opts.aliasAction = normalizeAliasAction(arg);
      continue;
    }

    switch (arg) {
      case '--help':
        printHelp();
        process.exit(0);
        return opts;
      case '--version':
        // handled by caller to print semantic version from package.json
        continue;
      case '--workspace':
        opts.projectPath = takeValue(argv, ++i, '--workspace');
        opts.projectPathSpecified = true;
        break;
      case '-p':
      case '--profile':
        opts.profileSlug = takeValue(argv, ++i, arg);
        opts.projectPathSpecified = true;
        break;
      case '-a':
      case '--alias':
        opts.projectPath = `@${takeValue(argv, ++i, arg)}`;
        opts.projectPathSpecified = true;
        break;
      case '--name':
        opts.name = takeValue(argv, ++i, '--name');
        break;
      case '--runtime':
        opts.runtime = takeValue(argv, ++i, '--runtime') as 'docker' | 'podman';
        break;
      case '--socket':
        opts.socket = takeValue(argv, ++i, '--socket');
        break;
      case '--image':
        opts.image = takeValue(argv, ++i, '--image');
        opts.imageSpecified = true;
        break;
      case '--local-image':
        opts.localImage = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      default:
        if (arg.startsWith('-')) {
          fail(`Unknown option: ${arg}`);
        }

        if (opts.command === 'alias') {
          if (!opts.aliasName) {
            opts.aliasName = arg;
            continue;
          }
          if (opts.projectPath) {
            fail(`Unexpected extra argument: ${arg}`);
          }
          opts.projectPath = arg;
          opts.projectPathSpecified = true;
          continue;
        }

        if (opts.projectPath) {
          fail(`Unexpected extra argument: ${arg}`);
        }
        opts.projectPath = arg;
        opts.projectPathSpecified = true;
        break;
    }
  }

  if (opts.command === 'alias' && !opts.aliasAction) {
    opts.aliasAction = 'list';
  }

  return opts;
}

export function shouldPrintVersion(argv: string[]): boolean {
  return argv.includes('--version');
}

function normalizeAliasAction(action: string): AliasAction {
  switch (action) {
    case 'set':
    case 'add':
      return 'set';
    case 'rm':
    case 'remove':
    case 'delete':
      return 'rm';
    case 'list':
    case 'ls':
      return 'list';
    default:
      fail(`Unsupported alias action: ${action}`);
  }
}

function takeValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

export function printHelp(): void {
  console.log(`
Usage: conflux-workspace <command> [options] [project-path]

Commands:
  create <path>          Create a new project from the built-in template
  start <project-path>   Start the workspace for a project folder
  stop <project-path>    Stop the container for the target workspace profile
  rm <project-path>      Stop and remove the container for the target workspace profile
  purge <project-path>   Remove the target workspace profile container and home volume
  status [project-path]  Show detailed status (all managed profiles by default)
  list                   List known workspace profiles and aliases
  rebuild <project-path> Reset workspace: purge profile and start fresh
  alias [action]         Manage optional aliases for workspace targets
  doctor                 Check runtime, socket, state, and local CLI environment
  clean                  Remove stale profiles and aliases with no container and no volume

Options:
  --workspace <path>     Explicit project folder to bind-mount at /workspace
  -p, --profile <slug>   Target a known profile slug from list/status output
  -a, --alias <name>     Resolve a saved alias instead of passing a path
  --name <name>          Managed resource prefix (default: cfxdevkit-workspace)
  --runtime <r>          Force docker or podman (auto-detected by default)
  --socket <path>        Override Docker/Podman socket path
  --image <ref>          Override the image reference to use
  --local-image          Treat --image as a locally-built image (Podman uses localhost/)
  --verbose              Show underlying runtime command output
  --version              Print CLI version and exit
  --help                 Print this help and exit

Getting started:
  conflux-workspace create ./my-project     # scaffold a new project
  cd my-project && pnpm install             # install workspace dependencies
  conflux-workspace start ./my-project      # launch the dev container

Examples:
  conflux-workspace start /path/to/project
  conflux-workspace stop /path/to/project
  conflux-workspace purge --profile ws-123456789abc
  conflux-workspace start --alias demo
  conflux-workspace status
  conflux-workspace list
  conflux-workspace clean
  conflux-workspace doctor
  conflux-workspace alias set demo /path/to/project

Workspace persistence:
  Each workspace target gets its own managed home volume. Switching between
  different project paths restores the matching profile instead of reusing
  one global state volume. Optional aliases are stored in the host config
  directory so local scripts and published usage resolve the same target names.
`.trim());
}
