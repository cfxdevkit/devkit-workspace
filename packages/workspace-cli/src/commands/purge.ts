/**
 * commands/purge.ts — stop, remove container and volume, and unregister profile.
 */

import {
  removeTargetContainer,
  removeTargetVolume,
  stopTargetContainer,
} from '../runtime/container.js';
import { loadState, saveState } from '../state/loader.js';
import { removeProfile, resolveWorkspaceTarget } from '../state/profile.js';
import type { Options, Runtime } from '../types.js';

export function purgeWorkspace(runtime: Runtime, opts: Options): number {
  const state = loadState();
  const target = resolveWorkspaceTarget(opts, state);
  stopTargetContainer(runtime, target);
  removeTargetContainer(runtime, target);
  removeTargetVolume(runtime, target);
  removeProfile(state, target);
  saveState(state);
  console.log(`Purged ${target.containerName}`);
  console.log(`Removed ${target.volumeName}`);
  return 0;
}
