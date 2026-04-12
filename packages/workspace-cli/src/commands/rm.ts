/**
 * commands/rm.ts — stop and remove a workspace container (preserves volume).
 */

import { removeTargetContainer, stopTargetContainer } from '../runtime/container.js';
import { loadState, saveState } from '../state/loader.js';
import { resolveWorkspaceTarget } from '../state/profile.js';
import type { Options, Runtime } from '../types.js';

export function removeWorkspace(runtime: Runtime, opts: Options): number {
  const state = loadState();
  const target = resolveWorkspaceTarget(opts, state);
  saveState(state);
  stopTargetContainer(runtime, target);
  removeTargetContainer(runtime, target);
  console.log(`Removed container ${target.containerName}`);
  console.log(`Preserved volume ${target.volumeName}`);
  console.log('Use purge to remove the profile from list and delete its persisted state.');
  return 0;
}
