/**
 * commands/create.ts — scaffold a new project from the built-in template.
 */

import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { fail } from '../util.js';
import { copyBuiltInTemplate, isDirectoryEmpty } from '../template/index.js';
import { loadState, saveState } from '../state/loader.js';
import { createMountedTarget, registerProfile } from '../state/profile.js';
import type { Options } from '../types.js';

export function createWorkspace(opts: Options): number {
  if (opts.profileSlug) {
    fail('create does not support --profile; pass a destination folder path.');
  }

  if (!opts.projectPath) {
    fail('create requires a destination folder path.');
  }

  if (opts.projectPath.startsWith('@')) {
    fail('create does not support --alias; pass a destination folder path.');
  }

  const destinationPath = resolve(process.cwd(), opts.projectPath);

  if (existsSync(destinationPath)) {
    const destinationStats = statSync(destinationPath);
    if (!destinationStats.isDirectory()) {
      fail(`Destination exists and is not a directory: ${destinationPath}`);
    }

    if (!isDirectoryEmpty(destinationPath)) {
      fail(`Destination directory is not empty: ${destinationPath}`);
    }
  } else {
    mkdirSync(destinationPath, { recursive: true });
  }

  copyBuiltInTemplate(destinationPath);

  // Register an alias based on the destination folder name.
  const resolvedDestination = realpathSync(destinationPath);
  const rawName = basename(destinationPath).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const baseAlias = /^[a-z0-9]/.test(rawName) ? rawName : `p-${rawName}`;

  const state = loadState();
  const target = createMountedTarget(opts.name, resolvedDestination);
  registerProfile(state, target);

  const aliasName = uniqueAlias(state.aliases, baseAlias);
  state.aliases[aliasName] = target.profileKey;
  saveState(state);

  console.log(`Created project at ${destinationPath}`);
  console.log(`Registered as alias @${aliasName}`);
  console.log('');
  console.log('Next steps:');
  console.log(`  conflux-workspace start --alias ${aliasName}`);
  console.log('');
  console.log('Then inside the workspace terminal (http://localhost:8080):');
  console.log('  pnpm install');
  console.log('  pnpm dev');
  return 0;
}

function uniqueAlias(existingAliases: Record<string, string>, baseAlias: string): string {
  if (!existingAliases[baseAlias]) return baseAlias;
  let counter = 1;
  while (existingAliases[`${baseAlias}_${counter}`]) counter += 1;
  return `${baseAlias}_${counter}`;
}
