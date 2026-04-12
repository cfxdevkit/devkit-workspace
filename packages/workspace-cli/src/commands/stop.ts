/**
 * commands/stop.ts — stop a workspace container.
 */

import { stopTargetContainer } from '../runtime/container.js';
import { loadState, saveState } from '../state/loader.js';
import { resolveWorkspaceTarget } from '../state/profile.js';
import type { Options, Runtime } from '../types.js';

export function stopWorkspace(runtime: Runtime, opts: Options): number {
  const state = loadState();
  const target = resolveWorkspaceTarget(opts, state);
  saveState(state);
  stopTargetContainer(runtime, target);
  console.log(`Stopped ${target.containerName}`);
  return 0;
}
