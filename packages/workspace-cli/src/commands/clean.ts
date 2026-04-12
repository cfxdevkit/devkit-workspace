/**
 * commands/clean.ts — remove stale profiles and aliases with no container and no volume.
 */

import { collectProfileSummaries } from '../runtime/container.js';
import { loadState, saveState } from '../state/loader.js';
import type { Options, Runtime } from '../types.js';

export function cleanRegistry(runtime: Runtime, opts: Options): number {
  const state = loadState();
  const profiles = collectProfileSummaries(runtime, opts, state);

  const removedProfiles: string[] = [];
  const removedAliases: string[] = [];

  for (const profile of profiles) {
    const isGone = profile.containerStatus === 'missing' && !profile.volumePresent;
    if (!isGone) continue;
    removedProfiles.push(profile.profileSlug);
    for (const aliasName of profile.aliases) {
      removedAliases.push(aliasName);
    }
    // Find and delete the stored profile entry by slug
    for (const [key, stored] of Object.entries(state.profiles)) {
      if (stored.profileSlug === profile.profileSlug) {
        delete state.profiles[key];
        break;
      }
    }
  }

  // Remove any aliases pointing at profiles that no longer exist
  for (const [aliasName, profileKey] of Object.entries(state.aliases)) {
    if (!state.profiles[profileKey] && profileKey !== 'builtin') {
      if (!removedAliases.includes(aliasName)) removedAliases.push(aliasName);
      delete state.aliases[aliasName];
    }
  }

  if (removedProfiles.length === 0 && removedAliases.length === 0) {
    console.log('Registry is clean — nothing to remove.');
    return 0;
  }

  saveState(state);

  if (removedAliases.length > 0) {
    console.log(`Removed aliases: ${removedAliases.map((a) => `@${a}`).join(', ')}`);
  }
  if (removedProfiles.length > 0) {
    console.log(`Removed profiles: ${removedProfiles.join(', ')}`);
  }
  return 0;
}
