/**
 * commands/list.ts — list all known workspace profiles.
 */

import { collectProfileSummaries, } from '../runtime/container.js';
import { loadState } from '../state/loader.js';
import { aliasDisplay, describeProfileState, renderTable } from '../util.js';
import type { Options, Runtime } from '../types.js';

export function showProfileList(runtime: Runtime, opts: Options): number {
  const state = loadState();
  const profiles = collectProfileSummaries(runtime, opts, state);

  if (profiles.length === 0) {
    console.log('No managed workspace profiles found.');
    return 0;
  }

  const rows = profiles.map((profile) => [
    profile.profileSlug,
    aliasDisplay(profile.aliases),
    describeProfileState(profile),
    profile.containerStatus,
    profile.volumePresent ? 'present' : 'missing',
    profile.display,
  ]);

  console.log(renderTable(['PROFILE', 'ALIASES', 'STATE', 'CONTAINER', 'VOLUME', 'WORKSPACE'], rows));
  return 0;
}
