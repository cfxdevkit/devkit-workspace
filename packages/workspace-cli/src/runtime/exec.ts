/**
 * runtime/exec.ts — low-level process execution helpers for container runtimes.
 */

import { execFileSync, spawnSync } from 'node:child_process';

import { fail } from '../util.js';
import type { Runtime } from '../types.js';

// ── Core exec primitives ───────────────────────────────────────────────────

/**
 * Run a runtime command, optionally inheriting stdio.
 * Returns the process exit code.
 */
export function run(runtime: Runtime, args: string[], inherit = true): number {
  const result = spawnSync(runtime, args, {
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    encoding: inherit ? undefined : 'utf8',
  });

  if (result.error) {
    fail(`Failed to run ${runtime}: ${result.error.message}`);
  }

  return result.status ?? 0;
}

/**
 * Run a command, surfacing output only on failure (unless verbose).
 */
export function runVisible(runtime: Runtime, args: string[], verbose: boolean): number {
  return runVisibleResult(runtime, args, verbose).status;
}

export function runVisibleResult(
  runtime: Runtime,
  args: string[],
  verbose: boolean,
): { status: number; stdout: string; stderr: string } {
  if (verbose) {
    return { status: run(runtime, args, true), stdout: '', stderr: '' };
  }

  const result = spawnSync(runtime, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) {
    fail(`Failed to run ${runtime}: ${result.error.message}`);
  }

  const status = result.status ?? 0;
  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();
  if (status !== 0) {
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
  }

  return { status, stdout, stderr };
}

/**
 * Run a command and return its stdout as a trimmed string.
 */
export function runCapture(runtime: Runtime, args: string[]): string {
  try {
    return execFileSync(runtime, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
