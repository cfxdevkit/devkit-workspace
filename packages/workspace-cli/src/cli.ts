#!/usr/bin/env node
/**
 * conflux-workspace CLI
 *
 * Thin entrypoint: parse args, detect runtime, dispatch to command modules.
 */

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleAliasCommand } from './commands/alias.js';
import { cleanRegistry } from './commands/clean.js';
import { createWorkspace } from './commands/create.js';
import { showDoctor } from './commands/doctor.js';
import { showProfileList } from './commands/list.js';
import { showLogs } from './commands/logs.js';
import { purgeWorkspace } from './commands/purge.js';
import { rebuildWorkspace } from './commands/rebuild.js';
import { removeWorkspace } from './commands/rm.js';
import { startWorkspace, DEFAULT_IMAGE_PREFIX } from './commands/start.js';
import { showStatus } from './commands/status.js';
import { stopWorkspace } from './commands/stop.js';
import { parseArgs, printHelp, shouldPrintVersion } from './parser.js';
import { detectRuntime, validateRuntimeAccess } from './runtime/detect.js';
import { run } from './runtime/exec.js';
import type { Runtime } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);
const pkg = require(join(__dirname, '..', 'package.json')) as { version: string };

const CLI_VERSION = pkg.version;
const DEFAULT_IMAGE = `${DEFAULT_IMAGE_PREFIX}${CLI_VERSION}`;

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  if (shouldPrintVersion(args)) {
    console.log(CLI_VERSION);
    process.exit(0);
  }

  const opts = parseArgs(args, DEFAULT_IMAGE);
  const runtime =
    opts.command === 'alias' || opts.command === 'doctor' || opts.command === 'create'
      ? null
      : detectRuntime(opts.runtime);

  if (runtime) {
    validateRuntimeAccess(runtime, run);
  }

  const status = dispatch(opts.command, runtime as Runtime, opts);
  process.exit(status);
}

function dispatch(command: string, runtime: Runtime, opts: ReturnType<typeof parseArgs>): number {
  switch (command) {
    case 'start':
      return startWorkspace(runtime, opts, DEFAULT_IMAGE);
    case 'stop':
      return stopWorkspace(runtime, opts);
    case 'rm':
      return removeWorkspace(runtime, opts);
    case 'purge':
      return purgeWorkspace(runtime, opts);
    case 'status':
      return showStatus(runtime, opts);
    case 'list':
      return showProfileList(runtime, opts);
    case 'logs':
      return showLogs(runtime, opts);
    case 'rebuild':
      return rebuildWorkspace(runtime, opts, DEFAULT_IMAGE);
    case 'alias':
      return handleAliasCommand(opts);
    case 'doctor':
      return showDoctor(opts, CLI_VERSION);
    case 'create':
      return createWorkspace(opts);
    case 'clean':
      return cleanRegistry(runtime, opts);
    default:
      return 1;
  }
}

main();
