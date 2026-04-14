/**
 * commands/logs.ts — show recent logs for a workspace container.
 */

import { loadState } from '../state/loader.js';
import { resolveWorkspaceTarget } from '../state/profile.js';
import { run } from '../runtime/exec.js';
import type { Options, Runtime } from '../types.js';

export function showLogs(runtime: Runtime, opts: Options): number {
  const state = loadState();
  const target = resolveWorkspaceTarget(opts, state);

  console.log(`Showing recent logs for ${target.containerName}...`);
  const status = run(runtime, ['logs', '--tail', '200', target.containerName], true);

  if (status !== 0) {
    console.error('Unable to fetch workspace logs. Start the workspace first or check conflux-workspace status.');
  }

  return status;
}
